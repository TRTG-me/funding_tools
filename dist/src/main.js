"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const telegraf_1 = require("telegraf");
const prisma_service_1 = require("./modules/database/prisma.service");
const binance_controller_1 = require("./modules/binance/binance.controller");
const bot = new telegraf_1.Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const binanceController = new binance_controller_1.BinanceController();
// 1. Middleware для проверки прав (UID в БД)
bot.use(async (ctx, next) => {
    if (!ctx.from)
        return;
    const user = await prisma_service_1.prisma.user.findUnique({
        where: { telegramId: BigInt(ctx.from.id) }
    });
    if (user) {
        return next();
    }
    else {
        // Если пользователя нет в БД, не отвечаем на кнопки
        if (ctx.message && 'text' in ctx.message && ctx.message.text === '/start') {
            return ctx.reply(`Доступ запрещен. Ваш ID: ${ctx.from.id}`);
        }
        return;
    }
});
// 2. Главное меню (Клавиатура)
const mainKeyboard = telegraf_1.Markup.keyboard([
    ['📊 Обновить Binance', '💰 Расчет фандинга'],
    ['⚙️ Настройки']
]).resize();
// 3. Обработка команд
bot.start((ctx) => {
    ctx.reply('Добро пожаловать в Funding Bot! Выберите действие:', mainKeyboard);
});
// 4. Обработка кнопок
bot.hears('📊 Обновить Binance', async (ctx) => {
    await binanceController.handleSync(ctx);
});
bot.hears('💰 Расчет фандинга', (ctx) => {
    ctx.reply('Функционал в разработке...');
});
// Запуск
bot.launch().then(() => console.log('🚀 Бот запущен'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
//# sourceMappingURL=main.js.map