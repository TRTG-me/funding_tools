import axios from 'axios';
import { prisma } from '../database/prisma.service';

export interface BinanceFundingInfo {
    symbol: string;
    fundingIntervalHours: number;
}

export interface BinanceHistoricalFunding {
    symbol: string;
    fundingRate: string;
    fundingTime: number;
}

export class BinanceService {
    private readonly apiUrl = 'https://fapi.binance.com/fapi/v1/fundingInfo';
    private readonly historicalUrl = 'https://fapi.binance.com/fapi/v1/fundingRate';

    async getRawData(): Promise<BinanceFundingInfo[]> {
        try {
            const { data } = await axios.get<BinanceFundingInfo[]>(this.apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });
            return data;
        } catch (error: any) {
            console.error(`[Binance] Connection Error: ${error.message}`);
            throw error;
        }
    }

    async syncHistoricalFunding() {
        const coins = await prisma.binanceCoin.findMany();
        const now = Date.now();
        const defaultStartTime = now - 14 * 24 * 60 * 60 * 1000;

        let totalSaved = 0;
        const startTimeProcessing = Date.now();

        const latestRecords = await prisma.binanceFunding.groupBy({
            by: ['coin'],
            _max: { date: true }
        });

        const lastRecordMap = new Map<string, number>();
        latestRecords.forEach(r => {
            if (r.coin && r._max.date) lastRecordMap.set(r.coin, Number(r._max.date));
        });

        const CHUNK_SIZE = 50;
        for (let i = 0; i < coins.length; i += CHUNK_SIZE) {
            const chunk = coins.slice(i, i + CHUNK_SIZE);
            const coinsToFetch = [];

            for (const coinEntry of chunk) {
                let baseSymbol = coinEntry.coin.replace('USDT', '').replace(/^1000/, '');
                if (baseSymbol.startsWith('k') && baseSymbol.length > 1 && baseSymbol[1] === baseSymbol[1].toUpperCase()) {
                    baseSymbol = baseSymbol.substring(1);
                }

                const lastDate = lastRecordMap.get(baseSymbol);
                if (lastDate && (now - lastDate < 55 * 60 * 1000)) continue;

                coinsToFetch.push({ ...coinEntry, baseSymbol, lastDate: lastDate || defaultStartTime });
            }

            if (coinsToFetch.length === 0) continue;

            await Promise.all(coinsToFetch.map(async (item) => {
                try {
                    const fetchStartTime = item.lastDate === defaultStartTime ? defaultStartTime : item.lastDate + 60 * 1000;
                    const { data } = await axios.get<BinanceHistoricalFunding[]>(this.historicalUrl, {
                        params: { symbol: item.coin, startTime: fetchStartTime, limit: 1000 },
                        headers: { 'User-Agent': 'Mozilla/5.0' }
                    });

                    if (data.length > 0) {
                        const records = data.map(record => ({
                            coin: item.baseSymbol,
                            fundingRate: record.fundingRate,
                            date: BigInt(record.fundingTime)
                        }));

                        await prisma.binanceFunding.createMany({ data: records, skipDuplicates: true });
                        totalSaved += records.length;
                    }
                } catch (error: any) {
                    console.error(`[Binance] Error for ${item.coin}: ${error.message}`);
                }
            }));

            await new Promise(resolve => setTimeout(resolve, 200));
        }

        const duration = ((Date.now() - startTimeProcessing) / 1000).toFixed(1);
        return { totalSaved, duration };
    }
}