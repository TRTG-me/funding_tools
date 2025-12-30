import { Context } from 'telegraf';
import { HyperliquidService } from './hyperliquid.service';

export class HyperliquidController {
    private hlService = new HyperliquidService();
    private isProcessing = false;

    async handleSyncFunding(ctx: Context) {
        if (this.isProcessing) {
            return ctx.reply('⚠️ Синхронизация Hyperliquid уже идет...');
        }

        this.isProcessing = true;
        await ctx.reply('⏳ Начинаю сбор данных Hyperliquid (за 14 дней).\nЭто займет около 6 минут из-за лимитов API. Я сообщу, когда закончу!');

        // Запускаем сбор В ФОНЕ, чтобы не ловить тайм-аут 90с
        this.hlService.syncHistoricalFunding()
            .then(async (result) => {
                await ctx.reply(
                    `✅ *Сбор Hyperliquid завершен!*\n\n` +
                    `📊 Сохранено записей: *${result.totalSaved}*\n` +
                    `⏱ Время выполнения: *${result.duration}* сек.`,
                    { parse_mode: 'Markdown' }
                );
            })
            .catch(async (error) => {
                console.error('Ошибка в фоне Hyperliquid:', error);
                await ctx.reply('❌ Произошла ошибка при фоновом сборе данных Hyperliquid.');
            })
            .finally(() => {
                this.isProcessing = false;
            });
    }

}
