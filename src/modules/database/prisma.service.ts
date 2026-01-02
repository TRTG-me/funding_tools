import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
    log: ['error', 'warn'],
    errorFormat: 'minimal',
});

// Автоматическое переподключение при потере связи
let retryCount = 0;
const MAX_RETRIES = 3;

async function connectWithRetry() {
    try {
        await prisma.$connect();
        console.log('✅ Database connected successfully');
        retryCount = 0;
    } catch (error: any) {
        retryCount++;
        console.error(`❌ Database connection failed (attempt ${retryCount}/${MAX_RETRIES}):`, error.message);

        if (retryCount < MAX_RETRIES) {
            console.log(`🔄 Retrying in 5 seconds...`);
            setTimeout(() => connectWithRetry(), 5000);
        } else {
            console.error('💥 Database connection failed after max retries. Please check your database server.');
        }
    }
}

// Инициализация подключения
connectWithRetry();

// Graceful shutdown
process.on('beforeExit', async () => {
    console.log('🔌 Disconnecting from database...');
    await prisma.$disconnect();
});

process.on('SIGINT', async () => {
    console.log('🔌 Disconnecting from database (SIGINT)...');
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🔌 Disconnecting from database (SIGTERM)...');
    await prisma.$disconnect();
    process.exit(0);
});
