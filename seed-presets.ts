
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    const presets = [
        { name: 'Preset 1', h8: 30, d1: 30, d3: 25, d7: 25, d14: 20 },
        { name: 'Preset 2', h8: 20, d1: 20, d3: 15, d7: 15, d14: 10 },
        { name: 'Preset 3', h8: 40, d1: 40, d3: 35, d7: 35, d14: 30 },
        { name: 'Preset 4', h8: 10, d1: 10, d3: 5, d7: 5, d14: 0 },
        { name: 'Preset 5', h8: 50, d1: 50, d3: 45, d7: 45, d14: 40 },
    ];

    for (const p of presets) {
        await prisma.fundingPreset.upsert({
            where: { name: p.name },
            update: {},
            create: p,
        });
    }
    console.log('✅ Presets seeded');
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
