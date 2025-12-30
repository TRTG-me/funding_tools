import { Context, Markup } from 'telegraf';
import { CalcFundingsService } from './calc-fundings.service';

// Храним состояние в памяти (для теста достаточно)
const userStates = new Map<number, { coin: string, selected: string[] }>();

export class CalcFundingsController {
    private service = new CalcFundingsService();

    async startFlow(ctx: Context) {
        await ctx.reply('🔍 Введите название монеты (например, BTC, ETH или PEPE):');
        userStates.set(ctx.from!.id, { coin: '', selected: [] });
    }

    async handleText(ctx: Context): Promise<boolean> {
        if (!ctx.from || !ctx.message || !('text' in ctx.message)) return false;

        const userId = ctx.from.id;
        const state = userStates.get(userId);

        if (!state || state.coin !== '') return false;

        const coin = ctx.message.text.trim().toUpperCase();
        const exchanges = await this.service.getExchangesForCoin(coin);

        if (exchanges.length === 0) {
            await ctx.reply(`❌ Монета *${coin}* не найдена в базе данных.`, { parse_mode: 'Markdown' });
            userStates.delete(userId);
            return true;
        }

        state.coin = coin;

        const buttons = exchanges.map(ex => Markup.button.callback(ex, `calc_ex1_${ex}`));
        await ctx.reply(`Монета *${coin}* найдена на: ${exchanges.join(', ')}\nВыберите *первую* биржу для расчета:`, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons, { columns: 5 })
        });

        return true;
    }

    async showBestOpportunities(ctx: Context) {
        await ctx.reply('⏳ Запускаю сканер лучших возможностей по всем биржам...\nЭто может занять 10-20 секунд.');

        try {
            const best = await this.service.findBestOpportunities();

            if (best.length === 0) {
                return ctx.reply('📭 На данный момент монет, подходящих под критерии фильтра, не найдено.');
            }

            let report = '💎 *ТОП-20 ВОЗМОЖНОСТЕЙ (APR %)*\n\n';

            const c0 = 12; // COIN/PAIR (Wider to fix Resolv etc)
            const cW = 5;  // DATA

            let table = '```\n';
            table += `┌${'─'.repeat(c0)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┐\n`;
            table += `│${'COIN (P)'.padEnd(c0)}│${'8h'.padStart(cW)}│${'1d'.padStart(cW)}│${'3d'.padStart(cW)}│${'7d'.padStart(cW)}│${'14d'.padStart(cW)}│\n`;
            table += `├${'─'.repeat(c0)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┤\n`;

            for (const item of best) {
                const label = `${item.coin.substring(0, 6)} (${item.pair})`;
                const row = `│${label.substring(0, c0).padEnd(c0)}│${item.diffs.map((v: number) => v.toFixed(0).padStart(cW)).join('│')}│\n`;
                table += row;
            }

            table += `└${'─'.repeat(c0)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┘\n`;
            table += '```';

            report += table;
            report += '\n_*(P): Направление. Например H-B: Long HL / Short Binance*_';

            await ctx.reply(report, { parse_mode: 'Markdown' });
        } catch (error: any) {
            console.error('Best Opportunities Error:', error);
            await ctx.reply('❌ Произошла ошибка при сканировании.');
        }
    }

    async handleCallback(ctx: Context) {
        if (!ctx.from || !ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

        const userId = ctx.from.id;
        const state = userStates.get(userId);
        if (!state) return;

        const data = ctx.callbackQuery.data;

        if (data.startsWith('calc_ex1_')) {
            const ex1 = data.replace('calc_ex1_', '');

            state.selected = [ex1];

            const allExchanges = await this.service.getExchangesForCoin(state.coin);
            const remaining = allExchanges.filter(ex => ex !== ex1);

            if (remaining.length === 0) {
                await ctx.reply('Для этой монеты нет других доступных бирж.');
                userStates.delete(userId);
                return;
            }

            const buttons = remaining.map(ex => Markup.button.callback(ex, `calc_ex2_${ex}`));
            await ctx.editMessageText(`Вы выбрали первую биржу: *${ex1}*\nВыберите *вторую* биржу:`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons, { columns: 5 })
            });

        } else if (data.startsWith('calc_ex2_')) {
            const ex2 = data.replace('calc_ex2_', '');
            const ex1 = state.selected[0];

            await ctx.editMessageText(`⏳ Рассчитываю фандинг для ${state.coin}...`);

            const results = await this.service.getComparison(state.coin, ex1, ex2);

            // Настройки ширины: Колонка 0 = 8 символов, Данные = 6 символов
            const c0 = 8;
            const cW = 6;

            const formatVal = (val: number) => {
                const s = val.toFixed(1);
                // Если число слишком длинное для 6 символов (н-р -1234.5), убираем дробь
                return (s.length > cW ? val.toFixed(0) : s).padStart(cW);
            };

            const name1 = ex1.substring(0, c0).padEnd(c0);
            const name2 = ex2.substring(0, c0).padEnd(c0);

            let report = `💎 *${state.coin}*: ${ex1} 🆚 ${ex2}\n\n`;

            let table = '```\n';
            const line = `├${'─'.repeat(c0)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┤\n`;
            const top = `┌${'─'.repeat(c0)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┐\n`;
            const bottom = `└${'─'.repeat(c0)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┴${'─'.repeat(cW)}┘\n`;

            table += top;
            table += `│${'T-APR'.padEnd(c0)}│${'8h'.padStart(cW)}│${'1d'.padStart(cW)}│${'3d'.padStart(cW)}│${'7d'.padStart(cW)}│${'14d'.padStart(cW)}│\n`;
            table += line;

            // Биржа 1
            table += `│${name1}│${results.map(r => formatVal(r.apr1)).join('│')}│\n`;
            // Биржа 2
            table += `│${name2}│${results.map(r => formatVal(r.apr2)).join('│')}│\n`;

            table += line;

            // DIFF
            table += `│${'DIFF'.padEnd(c0)}│${results.map(r => formatVal(r.diff)).join('│')}│\n`;
            table += bottom;
            table += '```';

            report += table;

            await ctx.editMessageText(report, { parse_mode: 'Markdown' });
            userStates.delete(userId);
        }

        await ctx.answerCbQuery();
    }
}
