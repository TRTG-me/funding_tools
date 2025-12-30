import { prisma } from '../database/prisma.service';
import { BinanceService } from '../binance/binance.service';
import { HyperliquidService } from '../hyperliquid/hyperliquid.service';
import { LighterService } from '../lighter/lighter.service';
import { ParadexService } from '../paradex/paradex.service';
import { ExtendedService } from '../extended/extended.service';

export class AddCoinsService {
    private binance = new BinanceService();
    private hl = new HyperliquidService();
    private lighter = new LighterService();
    private paradex = new ParadexService();
    private extended = new ExtendedService();

    async syncAllPairs() {
        console.log('📡 [AddCoins] Сбор данных со всех бирж...');
        const results = await Promise.allSettled([
            this.binance.getRawData(),
            this.hl.getRawData(),
            this.lighter.getRawData(),
            this.paradex.getRawData(),
            this.extended.getRawData(),
        ]);

        // Проверяем, есть ли ошибки. Если одна биржа упала - останавливаем всё.
        const exchanges = ['Binance', 'Hyperliquid', 'Lighter', 'Paradex', 'Extended'];
        const errors = results
            .map((res, i) => res.status === 'rejected' ? exchanges[i] : null)
            .filter(Boolean);

        if (errors.length > 0) {
            const errorMsg = `Ошибка получения данных от бирж: ${errors.join(', ')}. Синхронизация отменена, чтобы не стереть базу.`;
            console.error(`❌ [AddCoins] ${errorMsg}`);
            throw new Error(errorMsg);
        }

        const [binRaw, hlRaw, lightRaw, paradexRaw, extendedRaw] = results.map(res =>
            (res as PromiseFulfilledResult<any>).value
        );

        // 1.5. Фильтр по margin_mode: strictIsolated на Hyperliquid
        // Все монеты, которые на Гипере в режиме strictIsolated, исключаются ВООБЩЕ у всех
        const isolatedOnHlRaw = (hlRaw as any[]).filter(item => item.marginMode === 'strictIsolated');
        const excludedBaseSymbols = new Set<string>();

        isolatedOnHlRaw.forEach(item => {
            let base = item.name.replace(/^1000/, '');
            if (base.startsWith('k') && base.length > 1 && base[1] === base[1].toUpperCase()) base = base.substring(1);
            excludedBaseSymbols.add(base);
        });

        if (excludedBaseSymbols.size > 0) {
            console.log(`🚫 [AddCoins] Исключены из-за strictIsolated на HL: ${Array.from(excludedBaseSymbols).join(', ')}`);
        }

        // 2. Карты для нормализованных данных (Base Symbol -> Original Data)
        const maps = {
            binance: new Map<string, { original: string; interval: number }>(),
            hl: new Map<string, string>(),
            lighter: new Map<string, { original: string; marketId: number }>(),
            paradex: new Map<string, string>(),
            extended: new Map<string, string>(),
        };

        // --- Логика нормализации ---

        binRaw.forEach((item: any) => {
            if (item.symbol.endsWith('USDT')) {
                let base = item.symbol.replace('USDT', '').replace(/^1000/, '');
                if (base.startsWith('k') && base.length > 1 && base[1] === base[1].toUpperCase()) base = base.substring(1);

                if (!excludedBaseSymbols.has(base)) {
                    maps.binance.set(base, { original: item.symbol, interval: item.fundingIntervalHours });
                }
            }
        });

        hlRaw.forEach((item: any) => {
            if (!item.isDelisted) {
                let base = item.name.replace(/^1000/, '');
                if (base.startsWith('k') && base.length > 1 && base[1] === base[1].toUpperCase()) {
                    base = base.substring(1);
                }

                if (!excludedBaseSymbols.has(base)) {
                    maps.hl.set(base, item.name);
                }
            }
        });

        lightRaw.forEach((item: any) => {
            let base = item.symbol.replace(/^1000/, '');
            if (base.startsWith('k') && base.length > 1 && base[1] === base[1].toUpperCase()) base = base.substring(1);

            if (!excludedBaseSymbols.has(base)) {
                maps.lighter.set(base, { original: item.symbol, marketId: item.market_id });
            }
        });

        paradexRaw.forEach((item: any) => {
            let base = item.symbol.split('-')[0].replace(/^1000/, '');
            if (base.startsWith('k') && base.length > 1 && base[1] === base[1].toUpperCase()) {
                base = base.substring(1);
            }

            if (!excludedBaseSymbols.has(base)) {
                maps.paradex.set(base, item.symbol);
            }
        });

        extendedRaw.forEach((item: any) => {
            // Убираем -USD и префикс 1000 / k для сопоставления
            let base = item.name.replace('-USD', '').replace(/^1000/, '');
            if (base.startsWith('k') && base.length > 1 && base[1] === base[1].toUpperCase()) base = base.substring(1);

            if (!excludedBaseSymbols.has(base)) {
                maps.extended.set(base, item.name);
            }
        });

        // 3. Сбор всех уникальных базовых тикеров
        const allBases = new Set([
            ...maps.binance.keys(),
            ...maps.hl.keys(),
            ...maps.lighter.keys(),
            ...maps.paradex.keys(),
            ...maps.extended.keys(),
        ]);

        // 4. Фильтрация и подготовка данных для пакетной вставки
        const matchedBases: string[] = [];
        const insertData = {
            binance: [] as any[],
            hl: [] as any[],
            lighter: [] as any[],
            paradex: [] as any[],
            extended: [] as any[],
        };

        for (const base of allBases) {
            const exchKeys = Object.keys(maps) as Array<keyof typeof maps>;
            const presence = exchKeys.filter(key => maps[key].has(base));

            // Сохраняем только те, что есть на 2+ биржах
            if (presence.length >= 2) {
                matchedBases.push(base);

                if (maps.binance.has(base)) {
                    const d = maps.binance.get(base)!;
                    insertData.binance.push({ coin: d.original, interval: d.interval });
                }
                if (maps.hl.has(base)) {
                    insertData.hl.push({ coin: maps.hl.get(base)! });
                }
                if (maps.lighter.has(base)) {
                    const d = maps.lighter.get(base)!;
                    insertData.lighter.push({ coin: d.original, marketId: d.marketId });
                }
                if (maps.paradex.has(base)) {
                    insertData.paradex.push({ coin: maps.paradex.get(base)! });
                }
                if (maps.extended.has(base)) {
                    insertData.extended.push({ coin: maps.extended.get(base)! });
                }
            }
        }

        // 5. Выполнение транзакции (Очистка + Массовая вставка)
        return await prisma.$transaction(async (tx) => {
            // Удаляем всё старое параллельно
            await Promise.all([
                tx.binanceCoin.deleteMany(),
                tx.hyperliquidCoin.deleteMany(),
                tx.lighterCoin.deleteMany(),
                tx.paradexCoin.deleteMany(),
                tx.extendedCoin.deleteMany(),
            ]);

            // Вставляем новое параллельно (createMany)
            await Promise.all([
                insertData.binance.length && tx.binanceCoin.createMany({ data: insertData.binance }),
                insertData.hl.length && tx.hyperliquidCoin.createMany({ data: insertData.hl }),
                insertData.lighter.length && tx.lighterCoin.createMany({ data: insertData.lighter }),
                insertData.paradex.length && tx.paradexCoin.createMany({ data: insertData.paradex }),
                insertData.extended.length && tx.extendedCoin.createMany({ data: insertData.extended }),
            ]);

            return {
                totalMatched: matchedBases.length,
                symbols: matchedBases
            };
        }, {
            timeout: 15000 // Увеличиваем таймаут для 5 бирж
        });
    }
}
