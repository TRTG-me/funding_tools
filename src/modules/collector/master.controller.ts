import { Context } from 'telegraf';
import { BinanceService } from '../binance/binance.service';
import { HyperliquidService } from '../hyperliquid/hyperliquid.service';
import { ParadexService } from '../paradex/paradex.service';
import { LighterService } from '../lighter/lighter.service';
import { ExtendedService } from '../extended/extended.service';

export class MasterController {
    private binance = new BinanceService();
    private hl = new HyperliquidService();
    private paradex = new ParadexService();
    private lighter = new LighterService();
    private extended = new ExtendedService();

    private isProcessing = false;

    async handleFullSync(ctx: Context) {
        if (this.isProcessing) {
            return ctx.reply('⚠️ Обновление базы уже запущено. Пожалуйста, подождите.');
        }

        this.isProcessing = true;
        const mainMsg = await ctx.reply('🚀 *Запуск глобального обновления БД...*\nОпрашиваю 5 бирж параллельно.', { parse_mode: 'Markdown' });

        const startTime = Date.now();

        try {
            // Запускаем все биржи параллельно. У каждой внутри свои лимиты и задержки.
            const results = await Promise.allSettled([
                this.binance.syncHistoricalFunding(),
                this.hl.syncHistoricalFunding(),
                this.paradex.syncHistoricalFunding(),
                this.lighter.syncHistoricalFunding(),
                this.extended.syncHistoricalFunding(),
            ]);

            const labels = ['Binance', 'Hyperliquid', 'Paradex', 'Lighter', 'Extended'];
            let report = `📊 *Отчет об обновлении:*\n\n`;

            results.forEach((res, index) => {
                const label = labels[index];
                if (res.status === 'fulfilled') {
                    const { totalSaved, duration } = res.value;
                    report += `✅ *${label}*: ${totalSaved} зап. за ${duration}с\n`;
                } else {
                    console.error(`[Master] Error syncing ${label}:`, res.reason);
                    report += `❌ *${label}*: Ошибка (см. лог серв.)\n`;
                }
            });

            const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
            report += `\n🏁 *Всего затрачено:* ${totalDuration} сек.`;

            await ctx.reply(report, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('[Master] Global Sync Error:', error);
            await ctx.reply('💥 Произошла критическая ошибка при глобальном обновлении.');
        } finally {
            this.isProcessing = false;
        }
    }
}
