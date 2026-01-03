import axios, { AxiosResponse } from 'axios';
import { prisma } from '../database/prisma.service';

export interface ParadexMarket {
    symbol: string;
    asset_kind: string;
    funding_period_hours: number;
}

export interface ParadexFundingResult {
    market: string;
    funding_rate: string;
    created_at: number;
}

export interface ParadexFundingResponse {
    next: string | null;
    results: ParadexFundingResult[];
}

export class ParadexService {
    private readonly marketsUrl = 'https://api.prod.paradex.trade/v1/markets';
    private readonly fundingUrl = 'https://api.prod.paradex.trade/v1/funding/data';

    private normalizeSymbol(fullSymbol: string): string {
        let clean = fullSymbol.split('-')[0].replace(/^1000/, '');
        if (clean.startsWith('k') && clean.length > 1 && clean[1] === clean[1].toUpperCase()) {
            clean = clean.substring(1);
        }
        return clean;
    }

    async getRawData(): Promise<ParadexMarket[]> {
        try {
            const res = await axios.get<{ results: ParadexMarket[] }>(this.marketsUrl, { timeout: 15000 });
            return res.data.results.filter(m => m.asset_kind === 'PERP');
        } catch (error: any) {
            console.error(`[Paradex] Connection Error: ${error.message}`);
            throw error;
        }
    }

    private async fetchFundingPage(market: string, endAt: number, cursor: string | null): Promise<ParadexFundingResponse> {
        const response: AxiosResponse<ParadexFundingResponse> = await axios.get(this.fundingUrl, {
            params: { market, page_size: 5000, end_at: endAt, cursor }
        });
        return response.data;
    }

    async syncHistoricalFunding() {
        const coins = await prisma.paradexCoin.findMany();
        const mRes = await axios.get<{ results: ParadexMarket[] }>(this.marketsUrl);
        const marketMap = new Map(mRes.data.results.map(m => [m.symbol, m.funding_period_hours || 8]));

        const nowAt = new Date();
        nowAt.setMinutes(0, 0, 0);
        nowAt.setMilliseconds(0);
        const endAt = nowAt.getTime();
        const defaultStartTime = endAt - 14 * 24 * 60 * 60 * 1000;

        const latestRecords = await prisma.paradexFunding.groupBy({ by: ['coin'], _max: { date: true } });
        const isDbEmpty = latestRecords.length === 0;
        const lastRecordMap = new Map(latestRecords.map((r: any) => [r.coin, Number(r._max.date)]));

        let totalSaved = 0;
        const startTimeProcessing = Date.now();

        // Всегда 2 пачки если БД пуста (например 50 и 51 для 101 монеты), иначе одна полная пачка
        const chunks: any[][] = [];
        if (isDbEmpty && coins.length > 1) {
            const mid = Math.floor(coins.length / 2);
            chunks.push(coins.slice(0, mid));
            chunks.push(coins.slice(mid));
        } else {
            chunks.push(coins);
        }

        const syncResults: number[] = [];

        for (let idx = 0; idx < chunks.length; idx++) {
            const chunk = chunks[idx];
            console.log(`[Paradex] Загружаем пачку ${idx + 1}/${chunks.length} (${chunk.length} монет)...`);

            const chunkResults = await Promise.all(chunk.map(async (coinEntry) => {
                let coinsSaved = 0;
                try {
                    const baseSymbol = this.normalizeSymbol(coinEntry.coin);
                    const fundingPeriod = marketMap.get(coinEntry.coin) || 8;
                    const lastDate = lastRecordMap.get(baseSymbol);
                    const fetchStartTime = lastDate || defaultStartTime;

                    if (fetchStartTime >= endAt) return 0;
                    await new Promise(r => setTimeout(r, Math.random() * 5003));

                    const hourlyGroups = new Map<number, { sum: number, count: number }>();
                    let currentCursor: string | null = null;
                    let pageNum = 0;
                    let keepGoing = true;

                    while (keepGoing) {
                        const fData = await this.fetchFundingPage(coinEntry.coin, endAt, currentCursor);
                        pageNum++;

                        if (fData.results && fData.results.length > 0) {
                            for (const item of fData.results) {
                                if (item.created_at < fetchStartTime) { keepGoing = false; break; }

                                const d = new Date(item.created_at - 1);
                                d.setMinutes(0, 0, 0);
                                d.setMilliseconds(0);
                                d.setHours(d.getHours() + 1);
                                const hStamp = d.getTime();

                                if (!hourlyGroups.has(hStamp)) hourlyGroups.set(hStamp, { sum: 0, count: 0 });
                                const g = hourlyGroups.get(hStamp)!;
                                g.sum += parseFloat(item.funding_rate);
                                g.count += 1;
                            }
                        } else {
                            keepGoing = false;
                        }

                        currentCursor = fData.next;
                        if (!currentCursor) keepGoing = false;
                        if (keepGoing) await new Promise(r => setTimeout(r, pageNum % 13 === 0 ? 60002 : 302));
                    }

                    const recordsToSave = [];
                    for (const [hStamp, stats] of hourlyGroups.entries()) {
                        if (hStamp <= (lastDate || 0) || hStamp > endAt) continue;
                        recordsToSave.push({
                            coin: baseSymbol,
                            fundingRate: (stats.sum / stats.count / fundingPeriod).toFixed(12),
                            date: BigInt(hStamp)
                        });
                    }

                    if (recordsToSave.length > 0) {
                        await prisma.paradexFunding.createMany({ data: recordsToSave, skipDuplicates: true });
                        coinsSaved = recordsToSave.length;
                    }
                } catch (error: any) {
                    const serverMsg = error.response?.data ? JSON.stringify(error.response.data) : '';
                    console.error(`[Paradex] Error for ${coinEntry.coin}: ${error.message} ${serverMsg}`);
                }
                return coinsSaved;
            }));

            syncResults.push(...chunkResults);

            // Пауза только если есть следующая пачка
            if (idx < chunks.length - 1) {
                console.log(`[Paradex] Пауза 10с перед следующей пачкой...`);
                await new Promise(r => setTimeout(r, 10000));
            }
        }

        totalSaved = syncResults.reduce((acc, val) => acc + val, 0);

        const totalDuration = ((Date.now() - startTimeProcessing) / 1000).toFixed(1);
        return { totalSaved, duration: totalDuration };
    }
}
