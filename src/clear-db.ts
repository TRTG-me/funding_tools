import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🧨 ПОЛНАЯ ОЧИСТКА БАЗЫ ДАННЫХ...');

    try {
        const binanceDeleted = await prisma.binanceFunding.deleteMany();
        console.log(`✅ Binance: Удалено ${binanceDeleted.count} зап.`);

        const hyperDeleted = await prisma.hyperliquidFunding.deleteMany();
        console.log(`✅ Hyperliquid: Удалено ${hyperDeleted.count} зап.`);

        const paradexDeleted = await prisma.paradexFunding.deleteMany();
        console.log(`✅ Paradex: Удалено ${paradexDeleted.count} зап.`);

        const lighterDeleted = await prisma.lighterFunding.deleteMany();
        console.log(`✅ Lighter: Удалено ${lighterDeleted.count} зап.`);

        const extendedDeleted = await prisma.extendedFunding.deleteMany();
        console.log(`✅ Extended: Удалено ${extendedDeleted.count} зап.`);

        console.log('\n✨ База данных полностью очищена. Можно запускать синхронизацию с нуля.');
    } catch (error: any) {
        console.error('❌ Ошибка при очистке:', error.message);
    }
}

main()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
