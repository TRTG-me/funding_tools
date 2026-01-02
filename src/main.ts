import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { prisma } from './modules/database/prisma.service';
import { MasterController } from './modules/collector/master.controller';
import { AddCoinsService } from './modules/addCoinsDB/add-coins.service';
import { CalcFundingsController } from './modules/calcFundings/calc-fundings.controller';

// 1. Фикс для BigInt
(BigInt.prototype as any).toJSON = function () {
    return this.toString();
};

// 2. Инициализация
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!, {
    handlerTimeout: 36_000_000 // 10 часов
});
const masterController = new MasterController();
const addCoinsService = new AddCoinsService();
const calcFundingsController = new CalcFundingsController();

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
    }
});

// 4. Клавиатура
const mainKeyboard = Markup.keyboard([
    ['📊 Фандинг монеты', '💎 Top 20 монет'],
    ['💎 Обновить список монет', '🚀 Обновить Базу Данных'],
]).resize();

// 5. Обработчики
bot.start((ctx) => {
    ctx.reply('👋 Система готова к работе.', mainKeyboard);
});

bot.hears('🚀 Обновить Базу Данных', (ctx) => {
    masterController.handleFullSync(ctx).catch(err => console.error(err));
});

bot.hears('💎 Обновить список монет', (ctx) => {
    if (addCoinsService.isSyncing) {
        return ctx.reply('⚠️ Синхронизация торговых пар уже запущена другим пользователем. Пожалуйста, подождите.');
    }
    ctx.reply('⏳ Начинаю синхронизацию торговых пар...');
    runCoinSync(ctx).catch(err => console.error(err));
});

bot.hears('📊 Фандинг монеты', (ctx) => {
    calcFundingsController.startFlow(ctx).catch(err => console.error(err));
});

bot.hears('💎 Top 20 монет', (ctx) => {
    calcFundingsController.showBestOpportunities(ctx).catch(err => console.error(err));
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

// 6. Запуск
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
