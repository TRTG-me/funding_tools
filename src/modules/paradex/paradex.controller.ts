import { Context } from 'telegraf';
import { ParadexService } from './paradex.service';

export class ParadexController {
    private paradexService = new ParadexService();
    private isProcessing = false;

    async handleSyncFunding(ctx: Context) {
        if (this.isProcessing) {
            return ctx.reply('⚠️ Синхронизация Paradex уже идет...');
        }

        this.isProcessing = true;
        await ctx.reply('⏳ Начинаю параллельный сбор всех монет Paradex (за 2 недели).\nЭто займет около 5-7 минут. Я сообщу о завершении!');

        // Запускаем сбор по ВСЕМ монетам
        this.paradexService.syncHistoricalFunding()
            .then(async (result) => {
                await ctx.reply(
                    `✅ *Сбор Paradex завершен!*\n\n` +
                    `📊 Сохранено часовых записей: *${result.totalSaved}*\n` +
                    `⏱ Время выполнения: *${result.duration}* сек.`,
                    { parse_mode: 'Markdown' }
                );
            })
            .catch(async (error) => {
                console.error('Ошибка в фоне Paradex:', error);
                await ctx.reply('❌ Произошла ошибка при сборе данных Paradex.');
            })
            .finally(() => {
                this.isProcessing = false;
            });
    }
}
