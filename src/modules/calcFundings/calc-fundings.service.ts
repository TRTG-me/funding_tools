import { prisma } from '../database/prisma.service';

export class CalcFundingsService {
    private normalizeCoin(name: string, exchange: string): string {
        let base = name.toUpperCase();

        if (exchange === 'binance') {
            base = base.replace('USDT', '').replace(/^1000/, '').replace(/^100/, '');
        } else if (exchange === 'hl') {
            base = base.replace(/^1000/, '');
        } else if (exchange === 'lighter') {
            base = base.replace('-PERP', '').replace(/^1000/, '').replace(/^100/, '');
        } else if (exchange === 'paradex') {
            base = base.split('-')[0].replace(/^1000/, '');
        } else if (exchange === 'extended') {
            base = base.replace('-USD', '').replace(/^1000/, '');
        }

        if (base.startsWith('K') && base.length > 1 && base[1] === base[1].toUpperCase()) {
            base = base.substring(1);
        }

        return base;
    }

    async getExchangesForCoin(searchCoin: string) {
        const upperSearch = searchCoin.toUpperCase();

        const [bin, hl, light, par, ext] = await Promise.all([
            prisma.binanceCoin.findMany(),
            prisma.hyperliquidCoin.findMany(),
            prisma.lighterCoin.findMany(),
            prisma.paradexCoin.findMany(),
            prisma.extendedCoin.findMany(),
        ]);

        const avail: string[] = [];

        if (bin.find(c => this.normalizeCoin(c.coin, 'binance') === upperSearch)) avail.push('Binance');
        if (hl.find(c => this.normalizeCoin(c.coin, 'hl') === upperSearch)) avail.push('Hyperliquid');
        if (light.find(c => this.normalizeCoin(c.coin, 'lighter') === upperSearch)) avail.push('Lighter');
        if (par.find(c => this.normalizeCoin(c.coin, 'paradex') === upperSearch)) avail.push('Paradex');
        if (ext.find(c => this.normalizeCoin(c.coin, 'extended') === upperSearch)) avail.push('Extended');

        return avail;
    }

    private async getBinanceReferenceTime(coin: string): Promise<number | null> {
        const latest = await prisma.binanceFunding.findFirst({
            where: { coin },
            orderBy: { date: 'desc' }
        });
        if (!latest) return null;

        const date = new Date(Number(latest.date));
        date.setMinutes(5, 0, 0);
        date.setSeconds(0, 0);
        return date.getTime();
    }

    private getStandardReferenceTime(): number {
        const now = new Date();
        now.setMinutes(5, 0, 0);
        now.setSeconds(0, 0);
        return now.getTime();
    }

    async getExchangeAPR(exchange: string, coin: string, startTs: number, endTs: number, periodHours: number): Promise<number> {
        const query = { where: { coin, date: { gte: BigInt(startTs), lte: BigInt(endTs) } } };

        let records: any[] = [];
        if (exchange === 'Binance') records = await prisma.binanceFunding.findMany(query);
        else if (exchange === 'Hyperliquid') records = await prisma.hyperliquidFunding.findMany(query);
        else if (exchange === 'Paradex') records = await prisma.paradexFunding.findMany(query);
        else if (exchange === 'Lighter') records = await prisma.lighterFunding.findMany(query);
        else if (exchange === 'Extended') records = await prisma.extendedFunding.findMany(query);

        if (records.length === 0) return NaN;

        // --- ЛОГИКА ПРОВЕРКИ ПОЛНОТЫ ДАННЫХ (Gap Check) ---
        const firstRecordTs = Number(records.reduce((min, r) => (Number(r.date) < min ? Number(r.date) : min), Number(records[0].date)));
        const gapMs = firstRecordTs - startTs;
        const thresholdMs = (exchange === 'Binance' ? 481 : 61) * 60 * 1000;

        if (gapMs > thresholdMs) {
            return NaN;
        }

        const sum = records.reduce((acc, r) => acc + parseFloat(r.fundingRate), 0);
        const avg = (exchange === 'Binance') ? (sum / periodHours) : (sum / records.length);

        return avg * 24 * 365 * 100;
    }

    async getComparison(coin: string, ex1: string, ex2: string) {
        let referenceEndTime: number;
        if (ex1 === 'Binance' || ex2 === 'Binance') {
            const binTime = await this.getBinanceReferenceTime(coin);
            referenceEndTime = binTime || this.getStandardReferenceTime();
        } else {
            referenceEndTime = this.getStandardReferenceTime();
        }

        const periods = [
            { label: '8h', totalHours: 8 },
            { label: '1d', totalHours: 24 },
            { label: '3d', totalHours: 72 },
            { label: '7d', totalHours: 168 },
            { label: '14d', totalHours: 336 },
        ];

        return await Promise.all(periods.map(async (p) => {
            const endTs = referenceEndTime;
            const startTs = endTs - (p.totalHours * 60 * 60 * 1000 - 30 * 60 * 1000);

            const apr1 = await this.getExchangeAPR(ex1, coin, startTs, endTs, p.totalHours);
            const apr2 = await this.getExchangeAPR(ex2, coin, startTs, endTs, p.totalHours);

            return {
                period: p.label,
                apr1,
                apr2,
                diff: apr1 - apr2
            };
        }));
    }

    async getExchangeCoinList(exchange: string): Promise<string[]> {
        let coins: any[] = [];
        if (exchange === 'Binance') coins = await prisma.binanceCoin.findMany();
        else if (exchange === 'Hyperliquid') coins = await prisma.hyperliquidCoin.findMany();
        else if (exchange === 'Paradex') coins = await prisma.paradexCoin.findMany();
        else if (exchange === 'Lighter') coins = await prisma.lighterCoin.findMany();
        else if (exchange === 'Extended') coins = await prisma.extendedCoin.findMany();

        return coins.map(c => this.normalizeCoin(c.coin, exchange.toLowerCase()));
    }

    async findBestOpportunities(selected?: string[]) {
        const MIN_THRESHOLDS = { h8: 40, d1: 30, d3: 30, d7: 25, d14: 20 };
        const fullList = ['Binance', 'Hyperliquid', 'Paradex', 'Lighter', 'Extended'];
        const results: any[] = [];

        // Логика выбора пар
        let pairsToCompare: [string, string][] = [];
        const active = (selected && selected.length > 0) ? selected : fullList;

        if (active.length === 1) {
            const target = active[0];
            fullList.filter(e => e !== target).forEach(other => {
                pairsToCompare.push([target, other]);
            });
        } else {
            for (let i = 0; i < active.length; i++) {
                for (let j = i + 1; j < active.length; j++) {
                    pairsToCompare.push([active[i], active[j]]);
                }
            }
        }

        const coinLists = new Map<string, string[]>();
        const uniqueExchanges = Array.from(new Set(pairsToCompare.flat()));

        for (const ex of uniqueExchanges) {
            coinLists.set(ex, await this.getExchangeCoinList(ex));
        }

        const checkThresholds = (values: number[]) => {
            return values.every((v, idx) => {
                const threshold = Object.values(MIN_THRESHOLDS)[idx];
                return v >= threshold;
            });
        };

        for (const [exName1, exName2] of pairsToCompare) {
            const list1 = coinLists.get(exName1)!;
            const list2 = coinLists.get(exName2)!;
            const common = list1.filter(c => list2.includes(c));

            await Promise.all(common.map(async (coin) => {
                const diffs = await this.getComparison(coin, exName1, exName2);

                // Если есть NaN (листинг был недавно) - пропускаем монету
                if (diffs.some(d => isNaN(d.apr1) || isNaN(d.apr2))) return;

                const diffsArr = diffs.map(d => d.diff);
                const reversedDiffs = diffsArr.map(v => -v);

                // Случай 1: ex1 > ex2 (Short ex1, Long ex2) -> Направление ex2-ex1
                if (checkThresholds(diffsArr)) {
                    results.push({
                        coin,
                        pair: `${exName2[0]}-${exName1[0]}`,
                        diffs: diffsArr,
                        sortVal: diffsArr[2]
                    });
                }
                // Случай 2: ex2 > ex1 (Long ex1, Short ex2) -> Направление ex1-ex2
                else if (checkThresholds(reversedDiffs)) {
                    results.push({
                        coin,
                        pair: `${exName1[0]}-${exName2[0]}`,
                        diffs: reversedDiffs,
                        sortVal: reversedDiffs[2]
                    });
                }
            }));
        }

        // Сортировка по sortVal (теперь это 3 дня) и топ 20
        return results.sort((a, b) => b.sortVal - a.sortVal).slice(0, 20);
    }
}
