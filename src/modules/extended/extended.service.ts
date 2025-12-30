import axios from 'axios';
import { prisma } from '../database/prisma.service';

export interface ExtendedMarket {
    name: string;
    active: boolean;
    status: string;
}

export interface ExtendedFundingItem {
    f: string;
    T: number;
}

export interface ExtendedFundingResponse {
    status: string;
    data: ExtendedFundingItem[];
}

export class ExtendedService {
    private readonly apiUrl = 'https://api.starknet.extended.exchange/api/v1/info/markets';
    private readonly fundingUrl = (market: string) => `https://api.starknet.extended.exchange/api/v1/info/${market}/funding`;

    private normalizeSymbol(fullSymbol: string): string {
        let clean = fullSymbol.replace('-USD', '').replace(/^1000/, '');
        if (clean.startsWith('k') && clean.length > 1 && clean[1] === clean[1].toUpperCase()) {
            clean = clean.substring(1);
        }
        return clean;
    }

    async getRawData(): Promise<ExtendedMarket[]> {
        try {
            const { data } = await axios.get<{ data: ExtendedMarket[] }>(this.apiUrl, { timeout: 15000 });
            return (data.data || []).filter(m => m.active && m.status === 'ACTIVE');
        } catch (error: any) {
            console.error(`[Extended] Connection Error: ${error.message}`);
            throw error;
        }
    }

    async syncHistoricalFunding() {
        const coins = await prisma.extendedCoin.findMany();
        const now = new Date();
        now.setMinutes(0, 0, 0);
        now.setMilliseconds(0);
        const endTimestamp = now.getTime() + 60000;
        const defaultStartTime = endTimestamp - 14 * 24 * 60 * 60 * 1000;

        const latestRecords = await prisma.extendedFunding.groupBy({ by: ['coin'], _max: { date: true } });
        const lastRecordMap = new Map(latestRecords.map((r: any) => [r.coin, Number(r._max.date)]));

        let totalSaved = 0;
        const startTimeProcessing = Date.now();

        const CHUNK_SIZE = 30;
        for (let i = 0; i < coins.length; i += CHUNK_SIZE) {
            const chunk = coins.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (coinEntry) => {
                try {
                    const baseSymbol = this.normalizeSymbol(coinEntry.coin);
                    const lastDate = lastRecordMap.get(baseSymbol);
                    let fetchStartTime = lastDate ? lastDate + 1000 : defaultStartTime;

                    if (fetchStartTime >= endTimestamp) return;

                    const { data: response } = await axios.get<ExtendedFundingResponse>(this.fundingUrl(coinEntry.coin), {
                        params: { startTime: fetchStartTime, endTime: endTimestamp }
                    });

                    if (response.status === 'OK' && response.data?.length > 0) {
                        const newItems = response.data.filter(item => item.T > (lastDate || 0));
                        if (newItems.length > 0) {
                            const records = newItems.map(item => ({
                                coin: baseSymbol,
                                fundingRate: item.f,
                                date: BigInt(item.T)
                            }));
                            await prisma.extendedFunding.createMany({ data: records, skipDuplicates: true });
                            totalSaved += records.length;
                        }
                    }
                } catch (error: any) {
                    // console.error(`[Extended] Error for ${coinEntry.coin}: ${error.message}`);
                }
            }));
            if (i + CHUNK_SIZE < coins.length) await new Promise(r => setTimeout(r, 500));
        }

        const duration = ((Date.now() - startTimeProcessing) / 1000).toFixed(1);
        return { totalSaved, duration };
    }
}
