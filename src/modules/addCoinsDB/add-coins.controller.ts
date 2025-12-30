import { Context } from 'telegraf';
import { AddCoinsService } from './add-coins.service';

export class AddCoinsController {
    private addCoinsService = new AddCoinsService();

    async handleSync(ctx: Context) {
        try {
            // Отправляем промежуточное сообщение, так как запрос может длиться 2-5 секунд
            const statusMsg = await ctx.reply('⏳ Начинаю синхронизацию пар (Binance, HL, Lighter, Paradex, Extended)...');

            const result = await this.addCoinsService.syncAllPairs();

            await ctx.reply(
                `✅ Синхронизация завершена успешно!\n\n` +
                `📊 Найдено общих монет: *${result.totalMatched}*`,
                { parse_mode: 'Markdown' }
            );

            // Удаляем "загрузочное" сообщение (опционально)
            try {
                await ctx.deleteMessage(statusMsg.message_id);
            } catch (e) {
                // Игнорируем если не удалилось
            }

        } catch (error) {
            console.error('Ошибка в AddCoinsController:', error);
            await ctx.reply('❌ Произошла ошибка при синхронизации монет. Проверьте логи сервера.');
        }
    }
}