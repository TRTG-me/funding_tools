import { Context } from 'telegraf';
import { ExtendedService } from './extended.service';

export class ExtendedController {
    private extendedService = new ExtendedService();
    private isProcessing = false;

    async handleSyncFunding(ctx: Context) {
        if (this.isProcessing) {
            return ctx.reply('⚠️ Синхронизация Extended уже идет...');
        }

        this.isProcessing = true;
        await ctx.reply('⏳ Начинаю сбор данных Extended (Starknet).\nПоследовательно с задержкой 0.3с...');

        this.extendedService.syncHistoricalFunding()
            .then(async (result) => {
                await ctx.reply(
                    `✅ *Сбор Extended завершен!*\n\n` +
                    `📊 Сохранено записей: *${result.totalSaved}*\n` +
                    `⏱ Время выполнения: *${result.duration}* сек.`,
                    { parse_mode: 'Markdown' }
                );
            })
            .catch(async (error) => {
                console.error('Ошибка в фоне Extended:', error);
                await ctx.reply('❌ Произошла ошибка при сборе данных Extended.');
            })
            .finally(() => {
                this.isProcessing = false;
            });
    }
}
