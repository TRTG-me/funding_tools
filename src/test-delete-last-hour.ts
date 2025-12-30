import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * НАСТРОЙКА: Выбери биржу для очистки
 * 'binance' | 'hyperliquid' | 'paradex'
 */
const TARGET_EXCHANGE: string = 'lighter'; // <-- МЕНЯЙ ЗДЕСЬ

const tableMap: Record<string, { table: string, label: string }> = {
    binance: { table: 'binanceFunding', label: 'Binance' },
    hyperliquid: { table: 'hyperliquidFunding', label: 'Hyperliquid' },
    paradex: { table: 'paradexFunding', label: 'Paradex' },
    lighter: { table: 'lighterFunding', label: 'Lighter' },
    extended: { table: 'extendedFunding', label: 'Extended' }
};

async function main() {
    const config = tableMap[TARGET_EXCHANGE.toLowerCase()];

    if (!config) {
        console.error(`❌ Ошибка: Биржа "${TARGET_EXCHANGE}" не поддерживается.`);
        console.log('Доступные варианты: binance, hyperliquid, paradex');
        return;
    }

    console.log(`--- ОЧИСТКА ПОСЛЕДНЕГО ЧАСА: ${config.label} ---`);

    // 1. Находим самое позднее время
    const lastRecord = await (prisma[config.table as any] as any).findFirst({
        orderBy: { date: 'desc' }
    });

    if (!lastRecord) {
        console.log(`❌ В базе нет записей для ${config.label}.`);
        return;
    }

    const lastDate = Number(lastRecord.date);
    const oneHourAgo = lastDate - (60 * 60 * 1000 * 8);

    // 2. Удаляем записи за последний час
    const deleted = await (prisma[config.table as any] as any).deleteMany({
        where: {
            date: {
                gt: BigInt(oneHourAgo)
            }
        }
    });

    console.log(`✅ ${config.label}: Удалено записей: ${deleted.count}`);
    console.log(`🧹 Последняя метка была: ${new Date(lastDate).toISOString()}`);
    console.log(`🧹 Теперь последняя метка будет около: ${new Date(oneHourAgo).toISOString()}`);
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
