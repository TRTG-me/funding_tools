import { prisma } from '../database/prisma.service';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';

// Пороги фильтрации для сканера "Лучшие монеты" (APR %)
const SCAN_MIN_THRESHOLDS = { h8: 30, d1: 20, d3: 20, d7: 15, d14: 10 };

export class CalcFundingsService {
    private chartJSNodeCanvas: ChartJSNodeCanvas;

    constructor() {
        this.chartJSNodeCanvas = new ChartJSNodeCanvas({
            width: 1000,
            height: 500,
            backgroundColour: 'white'
        });
    }

    async getHourlyHistory(exchange: string, coin: string, startTs: number, endTs: number): Promise<{ date: number, rate: number }[]> {
        const query = {
            where: { coin, date: { gte: BigInt(startTs), lte: BigInt(endTs) } },
            orderBy: { date: 'asc' as const }
        };

        let records: any[] = [];
        if (exchange === 'Binance') records = await prisma.binanceFunding.findMany(query);
        else if (exchange === 'Hyperliquid') records = await prisma.hyperliquidFunding.findMany(query);
        else if (exchange === 'Paradex') records = await prisma.paradexFunding.findMany(query);
        else if (exchange === 'Lighter') records = await prisma.lighterFunding.findMany(query);
        else if (exchange === 'Extended') records = await prisma.extendedFunding.findMany(query);

        if (records.length === 0) return [];

        // Определяем множитель для APR.
        // Стандарт: rate * (записей в году) * 100
        let multiplier = 24 * 365 * 100; // По умолчанию 1-часовой фандинг

        if (exchange === 'Binance') {
            // Для бинанса проверяем частоту (8ч, 4ч или 1ч)
            if (records.length >= 2) {
                const diff = Math.abs(Number(records[records.length - 1].date) - Number(records[records.length - 2].date));
                const hours = Math.round(diff / 3600000);
                const freq = hours > 0 ? hours : 8; // Если 0 (ошибка данных), берем 8ч
                multiplier = (24 / freq) * 365 * 100;
            } else {
                multiplier = 3 * 365 * 100; // 8-часовой по умолчанию
            }
        }

        // Группируем по часам (убираем микро-смещения)
        const seen = new Set<number>();
        const result: { date: number, rate: number }[] = [];

        for (const r of records) {
            const hTs = Math.floor(Number(r.date) / 3600000) * 3600000;
            if (!seen.has(hTs)) {
                seen.add(hTs);
                result.push({
                    date: hTs,
                    rate: parseFloat(r.fundingRate) * multiplier
                });
            }
        }
        return result;
    }

    async generateMultiChart(coin: string, datasetsInfo: { label: string, history: any[] }[]): Promise<Buffer> {
        const colorMap: Record<string, string> = {
            'Binance': 'rgb(33, 150, 243)',     // Blue
            'Hyperliquid': 'rgb(244, 67, 54)', // Red
            'Paradex': 'rgb(76, 175, 80)',     // Green
            'Lighter': 'rgb(156, 39, 176)',     // Purple
            'Extended': 'rgb(255, 152, 0)'      // Orange
        };

        // Собираем все точки времени
        const allTimes = Array.from(new Set(datasetsInfo.flatMap(d => d.history.map(h => h.date)))).sort((a, b) => a - b);

        if (allTimes.length === 0) {
            // Если данных нет, создаем "пустой" график с надписью
            return await this.chartJSNodeCanvas.renderToBuffer({
                type: 'line',
                data: { labels: ['No Data'], datasets: [] },
                options: { plugins: { title: { display: true, text: `No historical data for ${coin}` } } }
            });
        }

        const labels = allTimes.map(t => {
            const d = new Date(t);
            return `${d.getDate()}.${d.getMonth() + 1} ${d.getHours()}:00`;
        });

        const chartDatasets = datasetsInfo.map(ds => {
            const historyMap = new Map(ds.history.map(h => [h.date, h.rate]));
            return {
                label: ds.label,
                data: allTimes.map(t => {
                    const val = historyMap.get(t);
                    return val !== undefined ? parseFloat(val.toFixed(1)) : null;
                }),
                borderColor: colorMap[ds.label] || '#000',
                backgroundColor: (colorMap[ds.label] || '#000').replace('rgb', 'rgba').replace(')', ', 0.1)'),
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.4,
                spanGaps: true
            };
        });

        const configuration: ChartConfiguration = {
            type: 'line',
            data: {
                labels,
                datasets: chartDatasets as any[]
            },
            options: {
                responsive: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${coin} Funding APR % (14 days)`,
                        font: { size: 20 }
                    },
                    legend: { position: 'bottom' }
                },
                scales: {
                    x: {
                        ticks: {
                            maxTicksLimit: 14,
                            callback: function (val, index) {
                                const label = this.getLabelForValue(index as number);
                                return label.split(' ')[0];
                            }
                        }
                    },
                    y: {
                        grid: {

                        },
                        ticks: {
                            callback: (value) => value + '%'
                        }
                    }
                }
            }
        };

        return await this.chartJSNodeCanvas.renderToBuffer(configuration);
    }

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
        const fullList = ['Binance', 'Hyperliquid', 'Paradex', 'Lighter', 'Extended'];
        const results: any[] = [];

        // 1. Определение пар для сравнения
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

        const uniqueExchanges = Array.from(new Set(pairsToCompare.flat()));
        const coinLists = new Map<string, string[]>();
        for (const ex of uniqueExchanges) {
            coinLists.set(ex, await this.getExchangeCoinList(ex));
        }

        // Собираем все монеты, которые участвуют хотя бы в одной паре
        const allCommonCoins = new Set<string>();
        for (const [ex1, ex2] of pairsToCompare) {
            const l1 = coinLists.get(ex1)!;
            const l2 = coinLists.get(ex2)!;
            l1.filter(c => l2.includes(c)).forEach(c => allCommonCoins.add(c));
        }

        if (allCommonCoins.size === 0) return [];

        // 2. БАЛК-ЗАГРУЗКА ДАННЫХ
        // Берем с запасом 15 дней для корректных gap-checks
        const nowMs = Date.now();
        const startTs = BigInt(nowMs - 15 * 24 * 60 * 60 * 1000);

        const fundingCache = new Map<string, Map<string, any[]>>(); // ex -> coin -> records[]

        await Promise.all(uniqueExchanges.map(async (ex) => {
            const coinMap = new Map<string, any[]>();
            fundingCache.set(ex, coinMap);

            let allRecords: any[] = [];
            const query = { where: { coin: { in: Array.from(allCommonCoins) }, date: { gte: startTs } } };

            if (ex === 'Binance') allRecords = await prisma.binanceFunding.findMany(query);
            else if (ex === 'Hyperliquid') allRecords = await prisma.hyperliquidFunding.findMany(query);
            else if (ex === 'Paradex') allRecords = await prisma.paradexFunding.findMany(query);
            else if (ex === 'Lighter') allRecords = await prisma.lighterFunding.findMany(query);
            else if (ex === 'Extended') allRecords = await prisma.extendedFunding.findMany(query);

            for (const r of allRecords) {
                if (!coinMap.has(r.coin)) coinMap.set(r.coin, []);
                coinMap.get(r.coin)!.push(r);
            }
        }));

        // 3. Расчет APR в памяти
        const referenceEndTime = this.getStandardReferenceTime();
        const periods = [
            { label: '8h', totalHours: 8 },
            { label: '1d', totalHours: 24 },
            { label: '3d', totalHours: 72 },
            { label: '7d', totalHours: 168 },
            { label: '14d', totalHours: 336 },
        ];

        const calculateAPRInMemory = (ex: string, coin: string, startTs: number, endTs: number, periodHours: number): number => {
            const records = fundingCache.get(ex)?.get(coin) || [];
            const filtered = records.filter(r => {
                const d = Number(r.date);
                return d >= startTs && d <= endTs;
            });

            if (filtered.length === 0) return NaN;

            // Gap Check
            const firstRecordTs = Math.min(...filtered.map(r => Number(r.date)));
            const gapMs = firstRecordTs - startTs;
            const thresholdMs = (ex === 'Binance' ? 481 : 61) * 60 * 1000;
            if (gapMs > thresholdMs) return NaN;

            const sum = filtered.reduce((acc, r) => acc + parseFloat(r.fundingRate), 0);
            const avg = (ex === 'Binance') ? (sum / periodHours) : (sum / filtered.length);
            return avg * 24 * 365 * 100;
        };

        const checkThresholds = (values: number[]) => {
            return values.every((v, idx) => {
                const threshold = Object.values(SCAN_MIN_THRESHOLDS)[idx];
                return v >= threshold;
            });
        };

        // 4. Сравнение
        for (const [ex1, ex2] of pairsToCompare) {
            const l1 = coinLists.get(ex1)!;
            const l2 = coinLists.get(ex2)!;
            const common = l1.filter(c => l2.includes(c));

            for (const coin of common) {
                const diffsArr: number[] = [];
                let hasNaN = false;

                for (const p of periods) {
                    const pEndTs = referenceEndTime; // Упрощаем для скана: используем общее время
                    const pStartTs = pEndTs - (p.totalHours * 60 * 60 * 1000 - 30 * 60 * 1000);

                    const apr1 = calculateAPRInMemory(ex1, coin, pStartTs, pEndTs, p.totalHours);
                    const apr2 = calculateAPRInMemory(ex2, coin, pStartTs, pEndTs, p.totalHours);

                    if (isNaN(apr1) || isNaN(apr2)) {
                        hasNaN = true;
                        break;
                    }
                    diffsArr.push(apr1 - apr2);
                }

                if (hasNaN) continue;

                const reversedDiffs = diffsArr.map(v => -v);

                if (checkThresholds(diffsArr)) {
                    results.push({
                        coin,
                        pair: `${ex2[0]}-${ex1[0]}`,
                        diffs: diffsArr,
                        sortVal: diffsArr[2]
                    });
                } else if (checkThresholds(reversedDiffs)) {
                    results.push({
                        coin,
                        pair: `${ex1[0]}-${ex2[0]}`,
                        diffs: reversedDiffs,
                        sortVal: reversedDiffs[2]
                    });
                }
            }
        }

        return results.sort((a, b) => b.sortVal - a.sortVal).slice(0, 30);
    }
}
