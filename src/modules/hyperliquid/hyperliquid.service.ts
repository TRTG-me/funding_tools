import axios from 'axios';
import { prisma } from '../database/prisma.service';

export interface HyperliquidUniverseItem {
    name: string;
    isDelisted?: boolean;
    marginMode?: string;
}

export interface HyperliquidMetaResponse {
    universe: HyperliquidUniverseItem[];
}

export interface HyperliquidFundingHistoryItem {
    coin: string;
    fundingRate: string;
    time: number;
}

export class HyperliquidService {
    private readonly apiUrl = 'https://api.hyperliquid.xyz/info';

    async getRawData(): Promise<HyperliquidUniverseItem[]> {
        try {
            const { data } = await axios.post<HyperliquidMetaResponse>(this.apiUrl,
                { type: 'meta' },
                { timeout: 15000 }
            );
            return data.universe || [];
        } catch (error: any) {
            console.error(`[Hyperliquid] Connection Error: ${error.message}`);
            throw error;
        }
    }

    async syncHistoricalFunding() {
        const coins = await prisma.hyperliquidCoin.findMany();
        const now = Date.now();
        const defaultStartTime = now - 14 * 24 * 60 * 60 * 1000;

        let totalSaved = 0;
        const startTimeProcessing = Date.now();

        const latestRecords = await prisma.hyperliquidFunding.groupBy({
            by: ['coin'],
            _max: { date: true }
        });

        const lastRecordMap = new Map<string, number>();
        latestRecords.forEach((r: any) => {
            if (r.coin && r._max.date) lastRecordMap.set(r.coin, Number(r._max.date));
        });

        // ПАЧКИ ПО 4 МОНЕТЫ (ОПТИМАЛЬНО: ~46 ПАЧЕК)
        const CHUNK_SIZE = 4;
        for (let i = 0; i < coins.length; i += CHUNK_SIZE) {
            const chunk = coins.slice(i, i + CHUNK_SIZE);

            const coinsToFetch = chunk.filter(coinEntry => {
                let baseSymbol = coinEntry.coin.replace(/^1000/, '');
                if (baseSymbol.startsWith('k') && baseSymbol.length > 1 && baseSymbol[1] === baseSymbol[1].toUpperCase()) {
                    baseSymbol = baseSymbol.substring(1);
                }
                const lastDate = lastRecordMap.get(baseSymbol);
                return !(lastDate && (now - lastDate < 55 * 60 * 1000));
            });

            if (coinsToFetch.length === 0) continue;

            let maxGapForChunk = 0;

            await Promise.all(coinsToFetch.map(async (coinEntry) => {
                let attempts = 0;
                while (attempts < 2) {
                    try {
                        let baseSymbol = coinEntry.coin.replace(/^1000/, '');
                        if (baseSymbol.startsWith('k') && baseSymbol.length > 1 && baseSymbol[1] === baseSymbol[1].toUpperCase()) {
                            baseSymbol = baseSymbol.substring(1);
                        }
                        const lastDate = lastRecordMap.get(baseSymbol);
                        const fetchStartTime = lastDate ? lastDate + 60 * 1000 : defaultStartTime;

                        const currentGap = now - fetchStartTime;
                        if (currentGap > maxGapForChunk) maxGapForChunk = currentGap;

                        const { data } = await axios.post<HyperliquidFundingHistoryItem[]>(this.apiUrl, {
                            type: 'fundingHistory',
                            coin: coinEntry.coin,
                            startTime: fetchStartTime
                        });

                        if (Array.isArray(data) && data.length > 0) {
                            const records = data.map(item => ({
                                coin: baseSymbol,
                                fundingRate: item.fundingRate,
                                date: BigInt(item.time)
                            }));
                            await prisma.hyperliquidFunding.createMany({ data: records, skipDuplicates: true });
                            totalSaved += records.length;
                        }
                        break;
                    } catch (error: any) {
                        attempts++;
                        const status = error?.response?.status;
                        if (status === 429 && attempts < 2) {
                            console.log(`⚠️ [Hyperliquid] Rate limit at ${coinEntry.coin}. Waiting 15s retry...`);
                            await new Promise(r => setTimeout(r, 15000));
                        } else if (status === 502 && attempts < 2) {
                            console.log(`⚠️ [Hyperliquid] Bad Gateway (502) at ${coinEntry.coin}. Waiting 30s retry...`);
                            await new Promise(r => setTimeout(r, 30000));
                        } else {
                            console.error(`[Hyperliquid] Error for ${coinEntry.coin}: ${error.message}${status ? ' (Status: ' + status + ')' : ''}`);
                            break;
                        }
                    }
                }
            }));

            // УМНАЯ ПАУЗА (Оптимизирована до 800мс / 1.5с)
            const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
            const sleepMs = maxGapForChunk < THREE_DAYS_MS ? 1000 : 1500;

            await new Promise(resolve => setTimeout(resolve, sleepMs));
        }

        const duration = ((Date.now() - startTimeProcessing) / 1000).toFixed(1);
        return { totalSaved, duration };
    }
}