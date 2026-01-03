import { Context } from 'telegraf';
import { MasterService } from './master.service';

export class MasterController {
    private service = new MasterService();

    async handleFullSync(ctx: Context) {
        if (this.service.getIsProcessing()) {
            return ctx.reply('⚠️ Обновление базы уже запущено. Пожалуйста, подождите.');
        }

        await ctx.reply('🚀 *Запуск глобального обновления БД...*\nОпрашиваю 5 бирж параллельно.', { parse_mode: 'Markdown' });

        try {
            const { report, totalDuration } = await this.service.syncAllExchanges();

            let msg = `📊 *Отчет об обновлении:*\n\n`;
            report.forEach(r => {
                if (r.success && 'totalSaved' in r) {
                    msg += `✅ *${r.label}*: ${r.totalSaved} зап. за ${r.duration}с\n`;
                } else {
                    msg += `❌ *${r.label}*: Ошибка\n`;
                }
            });

            msg += `\n🏁 *Всего затрачено:* ${totalDuration} сек.`;
            await ctx.reply(msg, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('[MasterController] Error:', error);
            await ctx.reply('💥 Произошла критическая ошибка при глобальном обновлении.');
        }
    }
}
