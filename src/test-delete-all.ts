import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * НАСТРОЙКА: Сколько часов удалить от последней записи
 */
const HOURS_TO_DELETE = 8;

const tableMap = [
    { table: 'binanceFunding', label: 'Binance' },
    { table: 'hyperliquidFunding', label: 'Hyperliquid' },
    { table: 'paradexFunding', label: 'Paradex' },
    { table: 'lighterFunding', label: 'Lighter' },
    { table: 'extendedFunding', label: 'Extended' }
];

async function main() {
    console.log(`🚀 Начинаю очистку последних ${HOURS_TO_DELETE} часов для ВСЕХ бирж...\n`);

    for (const config of tableMap) {
        try {
            // 1. Находим самое позднее время
            const lastRecord = await (prisma[config.table as any] as any).findFirst({
                orderBy: { date: 'desc' }
            });

            if (!lastRecord) {
                console.log(`⚠️ ${config.label}: Записей в базе нет.`);
                continue;
            }

            const lastDate = Number(lastRecord.date);
            const deleteFrom = lastDate - (60 * 60 * 1000 * HOURS_TO_DELETE);

            // 2. Удаляем записи
            const deleted = await (prisma[config.table as any] as any).deleteMany({
                where: {
                    date: {
                        gt: BigInt(deleteFrom)
                    }
                }
            });

            console.log(`✅ ${config.label}:`);
            console.log(`   - Удалено: ${deleted.count} зап.`);
            console.log(`   - Было до: ${new Date(lastDate).toISOString()}`);
            console.log(`   - Стало до: ${new Date(deleteFrom).toISOString()}\n`);

        } catch (error: any) {
            console.error(`❌ Ошибка при очистке ${config.label}:`, error.message);
        }
    }

    console.log('🏁 Очистка завершена.');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
