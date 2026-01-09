import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const tableMap: Record<string, { table: string, label: string }> = {
    binance: { table: 'binanceFunding', label: 'Binance' },
    hyperliquid: { table: 'hyperliquidFunding', label: 'Hyperliquid' },
    paradex: { table: 'paradexFunding', label: 'Paradex' },
    lighter: { table: 'lighterFunding', label: 'Lighter' },
    extended: { table: 'extendedFunding', label: 'Extended' }
};

async function main() {
    console.log('🚀 --- ЗАПУСК ПОЛНОЙ ОЧИСТКИ (Последние 8 часов для всех бирж) ---');

    for (const key of Object.keys(tableMap)) {
        const config = tableMap[key];
        try {
            // 1. Находим самое позднее время для конкретной биржи
            const lastRecord = await (prisma[config.table as any] as any).findFirst({
                orderBy: { date: 'desc' }
            });

            if (!lastRecord) {
                console.log(`⚠️  ${config.label}: Записей в базе не обнаружено. Пропускаю.`);
                continue;
            }

            const lastDate = Number(lastRecord.date);
            const eightHoursAgo = lastDate - (60 * 60 * 1000 * 8);

            // 2. Удаляем записи за последние 8 часов
            const deleted = await (prisma[config.table as any] as any).deleteMany({
                where: {
                    date: {
                        gt: BigInt(eightHoursAgo)
                    }
                }
            });

            console.log(`✅ ${config.label}:`);
            console.log(`   - Удалено записей: ${deleted.count}`);
            console.log(`   - Последняя метка была: ${new Date(lastDate).toISOString()}`);
            console.log(`   - Теперь база начинается с: ~${new Date(eightHoursAgo).toISOString()}`);
        } catch (err: any) {
            console.error(`❌ Ошибка при очистке ${config.label}: ${err.message}`);
        }
    }

    console.log('\n✨ --- ОЧИСТКА ВСЕХ БИРЖ ЗАВЕРШЕНА ---');
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
