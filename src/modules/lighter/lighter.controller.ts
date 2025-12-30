import { Context } from 'telegraf';
import { LighterService } from './lighter.service';

export class LighterController {
    private lighterService = new LighterService();
    private isProcessing = false;

    async handleSyncFunding(ctx: Context) {
        if (this.isProcessing) {
            return ctx.reply('⚠️ Синхронизация Lighter уже идет...');
        }

        this.isProcessing = true;
        await ctx.reply('⏳ Начинаю сбор данных Lighter (1h).\nПоследовательно с задержкой 0.3с...');

        this.lighterService.syncHistoricalFunding()
            .then(async (result) => {
                await ctx.reply(
                    `✅ *Сбор Lighter завершен!*\n\n` +
                    `📊 Сохранено записей: *${result.totalSaved}*\n` +
                    `⏱ Время выполнения: *${result.duration}* сек.`,
                    { parse_mode: 'Markdown' }
                );
            })
            .catch(async (error) => {
                console.error('Ошибка в фоне Lighter:', error);
                await ctx.reply('❌ Произошла ошибка при сборе данных Lighter.');
            })
            .finally(() => {
                this.isProcessing = false;
            });
    }
}
