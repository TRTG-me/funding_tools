import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const exchanges = [
    // Binance пропускаем по просьбе юзера (там 4ч и 8ч интервалы)
    { table: 'hyperliquidFunding', label: 'Hyperliquid' },
    { table: 'paradexFunding', label: 'Paradex' },
    { table: 'lighterFunding', label: 'Lighter' },
    { table: 'extendedFunding', label: 'Extended' }
];

const HOUR_MS = 3600000;
const DAY_MS = HOUR_MS * 24;
const FOURTEEN_DAYS_MS = DAY_MS * 14;

async function checkIntegrity() {
    const nowTs = Date.now();
    const currentHourEnd = Math.floor(nowTs / HOUR_MS) * HOUR_MS;
    const expectedStartTs = currentHourEnd - FOURTEEN_DAYS_MS;

    console.log('🔍 Проверка целостности данных (14 дней, строгая последовательность)...\n');
    console.log(`📌 Период проверки: ${new Date(expectedStartTs).toISOString()} ➔ ${new Date(currentHourEnd).toISOString()}\n`);

    for (const exchange of exchanges) {
        console.log(`📡 Анализ [${exchange.label}]...`);
        const table = (prisma as any)[exchange.table];

        const coins = await table.findMany({
            distinct: ['coin'],
            select: { coin: true }
        });

        if (coins.length === 0) {
            console.log(`   ⚠️ Нет данных в таблице.\n`);
            continue;
        }

        let totalGapsFound = 0;
        let totalStartIssues = 0;
        let totalEndIssues = 0;

        for (const { coin } of coins) {
            const records = await table.findMany({
                where: { coin },
                orderBy: { date: 'asc' },
                select: { date: true }
            });

            if (records.length === 0) continue;

            const firstDate = Number(records[0].date);
            const lastDate = Number(records[records.length - 1].date);

            // 1. Проверка на начало (должно быть около 14 дней назад)
            // Мы даем допуск в 1 час, так как первый запуск мог быть в середине часа
            if (firstDate > expectedStartTs + HOUR_MS) {
                console.log(`   ⚠️ [${coin}]: Позднее начало. Первая запись: ${new Date(firstDate).toISOString()} (Должна быть ~14 дн назад)`);
                totalStartIssues++;
            }

            // 2. Проверка на конец (должна быть запись за текущий закрытый час)
            if (lastDate < currentHourEnd - HOUR_MS) {
                console.log(`   ⚠️ [${coin}]: Данные обрываются. Последняя запись: ${new Date(lastDate).toISOString()}`);
                totalEndIssues++;
            }

            // 3. Проверка последовательности (дырки внутри)
            const gaps = [];
            for (let i = 0; i < records.length - 1; i++) {
                const current = Number(records[i].date);
                const next = Number(records[i + 1].date);
                const diff = next - current;

                // Строго 1 час (допуск 5 сек на сетевые лаги/округления)
                if (diff > HOUR_MS + 5000 || diff < HOUR_MS - 5000) {
                    const missedHours = Math.round(diff / HOUR_MS) - 1;
                    if (missedHours > 0) {
                        gaps.push({
                            from: new Date(current).toISOString(),
                            to: new Date(next).toISOString(),
                            hours: missedHours
                        });
                    }
                }
            }

            if (gaps.length > 0) {
                console.log(`   ❌ [${coin}]: Найдено дырок: ${gaps.length}`);
                gaps.forEach(g => {
                    console.log(`      └─ ${g.from} ➔ ${g.to} (Пропуск: ${g.hours} ч.)`);
                });
                totalGapsFound += gaps.length;
            }
        }

        if (totalGapsFound === 0 && totalStartIssues === 0 && totalEndIssues === 0) {
            console.log(`   ✅ Все данные целы и строго последовательны за 14 дней.\n`);
        } else {
            console.log(`   🛑 Итого по [${exchange.label}]: Дырок: ${totalGapsFound}, Проблем старта: ${totalStartIssues}, Проблем актуальности: ${totalEndIssues}\n`);
        }
    }

    console.log('🏁 Проверка завершена.');
}

checkIntegrity()
    .catch((e) => console.error(e))
    .finally(async () => await prisma.$disconnect());
