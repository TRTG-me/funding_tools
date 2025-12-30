import { Telegraf } from 'telegraf';

export const initBot = () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN is not defined in .env');
    }

    const bot = new Telegraf(token);

    bot.start((ctx) => {
        ctx.reply('Бот запущен и работает! Все системы в норме.');
    });

    bot.command('help', (ctx) => {
        ctx.reply('Это бот для сбора фандинга. Пока доступна только команда /start');
    });

    return bot;
};