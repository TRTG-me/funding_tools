import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { prisma } from './modules/database/prisma.service';
import { MasterController } from './modules/collector/master.controller';
import { AddCoinsService } from './modules/addCoinsDB/add-coins.service';
import { CalcFundingsController } from './modules/calcFundings/calc-fundings.controller';
import express from 'express';
import apiRouter from './modules/apiReference/api-reference.controller';

// 1. Фикс для BigInt
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

// 2. Инициализация
export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, {
    handlerTimeout: 900_000 // 10 минут (нужно для полной синхронизации БД)
});
const masterController = new MasterController();
const addCoinsService = new AddCoinsService();
const calcFundingsController = new CalcFundingsController();

// Простейший Rate Limite (1 запрос в 10 сек для сканера)
const lastScanTime = new Map<number, number>();
const SCAN_COOLDOWN = 10_000;

// 3. Авторизация (Middleware)
// ... (уже есть)
bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    try {
        const user = await prisma.user.findUnique({
            where: { telegramId: BigInt(ctx.from.id) }
        });
        if (user) return next();
        if (ctx.message && 'text' in ctx.message && ctx.message.text === '/start') {
            return ctx.reply(`⛔ Доступ запрещен. Ваш ID: ${ctx.from.id}`);
        }
    } catch (error: any) {
        console.error('Middleware Authorization Error:', error.message);
        // Безопасный ответ при сбое БД - НЕ пропускаем неавторизованных
        if (ctx.message && 'text' in ctx.message) {
            return ctx.reply('⚠️ Система временно недоступна. База данных переподключается, попробуйте через 10 секунд.');
        }
    }
});

// 4. Клавиатура
const mainKeyboard = Markup.keyboard([
    ['📊 Фандинг монеты', '💎 Лучшие монеты'],
    ['💎 Обновить список монет', '🚀 Обновить Базу Данных'],
]).resize();

// 5. Обработчики
bot.start((ctx) => {
    ctx.reply('👋 Система готова к работе.', mainKeyboard);
});

bot.hears('🚀 Обновить Базу Данных', async (ctx) => {
    try {
        await masterController.handleFullSync(ctx);
    } catch (err: any) {
        console.error('Full Sync Error:', err);
        await ctx.reply('❌ Ошибка обновления базы данных. Попробуйте позже.');
    }
});

bot.hears('💎 Обновить список монет', async (ctx) => {
    if (addCoinsService.isSyncing) {
        return ctx.reply('⚠️ Синхронизация торговых пар уже запущена другим пользователем. Пожалуйста, подождите.');
    }
    try {
        await ctx.reply('⏳ Начинаю синхронизацию торговых пар...');
        await runCoinSync(ctx);
    } catch (err: any) {
        console.error('Coin Sync Error:', err);
        await ctx.reply('❌ Ошибка синхронизации монет. Попробуйте позже.');
    }
});

bot.hears('📊 Фандинг монеты', async (ctx) => {
    try {
        await calcFundingsController.startFlow(ctx);
    } catch (err: any) {
        console.error('Funding Flow Error:', err);
        await ctx.reply('❌ Ошибка запуска анализа фандинга. Попробуйте позже.');
    }
});

bot.hears('💎 Лучшие монеты', async (ctx) => {
    const userId = ctx.from!.id;
    const now = Date.now();
    const last = lastScanTime.get(userId) || 0;

    if (now - last < SCAN_COOLDOWN) {
        const remaining = Math.ceil((SCAN_COOLDOWN - (now - last)) / 1000);
        return await ctx.reply(`⚠️ Пожалуйста, подождите ${remaining} сек. перед следующим сканированием.`);
    }

    try {
        await calcFundingsController.showBestOpportunities(ctx);
        lastScanTime.set(userId, now);
    } catch (err: any) {
        console.error('Top 20 Error:', err);
        await ctx.reply('❌ Ошибка сканирования топ монет. Попробуйте позже.');
    }
});

// Общий обработчик текста для ввода названия монеты
bot.on('text', async (ctx, next) => {
    const handled = await calcFundingsController.handleText(ctx).catch(err => {
        console.error('Text Handler Error:', err);
        return false;
    });
    if (!handled) return next();
});

// Обработчик кнопок выбора бирж
bot.on('callback_query', (ctx) => {
    calcFundingsController.handleCallback(ctx).catch(err => console.error('Callback Error:', err));
});

// 6. API Server (Express)
const app = express();
app.use(express.json());
app.use('/api', apiRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`📡 API Server is running on port ${PORT}`);
});

// 7. Запуск бота
bot.launch()
    .then(() => console.log('🚀 Бот запущен (Full Sync)'))
    .catch((err) => console.error('💥 Launch Error:', err.message));

// Функция для синхронизации монет
async function runCoinSync(ctx?: any) {
    try {
        const result = await addCoinsService.syncAllPairs();
        const msg = `✅ *[AutoSync]* Список монет обновлен!\nВсего активных пар: *${result.totalMatched}*`;

        if (ctx) {
            await ctx.reply(msg, { parse_mode: 'Markdown' });
        } else {
            const users = await prisma.user.findMany();
            for (const user of users) {
                try {
                    await bot.telegram.sendMessage(user.telegramId.toString(), msg, { parse_mode: 'Markdown' });
                } catch (e: any) {
                    console.error(`Failed to send sync msg to ${user.telegramId}:`, e.message);
                }
            }
        }
        console.log(`✅ [AutoSync] Обновлено: ${result.totalMatched} пар.`);
    } catch (error: any) {
        console.log('❌ [AutoSync] Critical Error:', error.message);
        if (ctx) {
            await ctx.reply(`❌ Ошибка синхронизации: ${error.message}`);
        }
    }
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
