import { Context } from 'telegraf';
import { BinanceService } from './binance.service';

export class BinanceController {
    private binanceService = new BinanceService();
    private isProcessing = false;

    async handleSyncFunding(ctx: Context) {
        if (this.isProcessing) {
            return ctx.reply('⚠️ Синхронизация уже идет. Пожалуйста, подождите завершения.');
        }

        try {
            this.isProcessing = true;
            await ctx.reply('⏳ Проверяю данные и догружаю недостающий фандинг Binance...');

            // 1. Запускаем умную синхронизацию
            const result = await this.binanceService.syncHistoricalFunding();


            await ctx.reply(
                `✅ Сбор данных Binance завершен!\n\n` +
                `📊 Сохранено записей: *${result.totalSaved}*\n` +
                `⏱ Время выполнения: *${result.duration}* сек.`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('Ошибка в BinanceController:', error);
            await ctx.reply('❌ Ошибка при синхронизации фандинга Binance.');
        } finally {
            this.isProcessing = false;
        }
    }
}
