import axios from 'axios';
import { prisma } from '../database/prisma.service';

interface LighterFundingItem {
    timestamp: number;
    rate: string;
    direction: 'long' | 'short';
}

interface LighterApiResponse {
    fundings: LighterFundingItem[];
}

export class LighterService {
    private readonly apiUrl = 'https://mainnet.zklighter.elliot.ai/api/v1/fundings';

    private normalizeSymbol(fullSymbol: string): string {
        let clean = fullSymbol.replace('-PERP', '').replace(/^1000/, '').replace(/^100/, '');
        if (clean.startsWith('k') && clean.length > 1 && clean[1] === clean[1].toUpperCase()) {
            clean = clean.substring(1);
        }
        return clean;
    }

    async getRawData(): Promise<any[]> {
        const url = 'https://mainnet.zklighter.elliot.ai/api/v1/funding-rates';
        try {
            const { data } = await axios.get(url, { timeout: 15000 });
            if (data && data.funding_rates && Array.isArray(data.funding_rates)) {
                return data.funding_rates.filter((item: any) => item.exchange === 'lighter');
            }
            return [];
        } catch (error: any) {
            console.error(`[Lighter] Connection Error: ${error.message}`);
            throw error;
        }
    }

    async syncHistoricalFunding() {
        const coins = await prisma.lighterCoin.findMany();
        const now = new Date();
        now.setMinutes(0, 0, 0);
        now.setMilliseconds(0);
        const endTimestamp = Math.floor((now.getTime() + 60000) / 1000);
        const defaultStart = endTimestamp - (14 * 24 * 60 * 60);

        let totalSaved = 0;
        const startTimeProcessing = Date.now();

        const latestRecords = await prisma.lighterFunding.groupBy({ by: ['coin'], _max: { date: true } });
        const lastRecordMap = new Map(latestRecords.map((r: any) => [r.coin, Number(r._max.date)]));

        const CHUNK_SIZE = 20;
        for (let i = 0; i < coins.length; i += CHUNK_SIZE) {
            const chunk = coins.slice(i, i + CHUNK_SIZE);

            await Promise.all(chunk.map(async (coinEntry) => {
                try {
                    const baseSymbol = this.normalizeSymbol(coinEntry.coin);
                    const lastDateMs = lastRecordMap.get(baseSymbol);
                    let startTimestamp = lastDateMs ? Math.floor(lastDateMs / 1000) + 3600 : defaultStart;

                    if (startTimestamp >= endTimestamp) return;

                    const countBack = !lastDateMs ? 336 : Math.max(1, Math.ceil((endTimestamp - startTimestamp) / 3600));

                    const { data } = await axios.get<LighterApiResponse>(this.apiUrl, {
                        params: { market_id: coinEntry.marketId, resolution: '1h', start_timestamp: startTimestamp, end_timestamp: endTimestamp, count_back: countBack }
                    });

                    if (data.fundings?.length > 0) {
                        const newFundings = data.fundings.filter(item => (item.timestamp * 1000) > (lastDateMs || 0));
                        if (newFundings.length > 0) {
                            const records = newFundings.map(item => ({
                                coin: baseSymbol,
                                fundingRate: ((parseFloat(item.rate) / 100) * (item.direction === 'short' ? -1 : 1)).toFixed(12),
                                date: BigInt(item.timestamp * 1000)
                            }));
                            await prisma.lighterFunding.createMany({ data: records, skipDuplicates: true });
                            totalSaved += records.length;
                        }
                    }
                } catch (error: any) {
                    console.error(`[Lighter] Error for ${coinEntry.coin}: ${error.message}`);
                }
            }));
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const duration = ((Date.now() - startTimeProcessing) / 1000).toFixed(1);
        return { totalSaved, duration };
    }
}