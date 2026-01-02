import { Context, Markup } from 'telegraf';
import { CalcFundingsService } from './calc-fundings.service';

const userStates = new Map<number, { coin: string, selected: string[] }>();
const scanStates = new Map<number, { selected: string[] }>();

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

        await ctx.reply(`Монета *${coin}* найдена на: ${exchanges.join(', ')}\nВыберите ОДНУ биржу для анализа:`, {
            parse_mode: 'Markdown',
            ...this.getCoinExchangesKeyboard(coin, exchanges, [])
        });

        return true;
    }

    private isScanning = false;

    async showBestOpportunities(ctx: Context) {
        const userId = ctx.from!.id;
        scanStates.delete(userId); // Очистка старого состояния

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🌐 Все биржи', 'scan_all')],
            [Markup.button.callback('⚙️ Ручной выбор', 'scan_manual')]
        ]);

        await ctx.reply('Выберите режим сканирования:', keyboard);
    }

    private async runScan(ctx: Context, selectedExchanges?: string[]) {
        if (this.isScanning) {
            return ctx.reply('⚠️ Сканер уже запущен. Пожалуйста, подождите завершения предыдущего поиска.');
        }

        try {
            this.isScanning = true;
            await ctx.reply('⏳ Запускаю сканер лучших возможностей...\nЭто может занять 15-30 секунд.');

            const best = await this.service.findBestOpportunities(selectedExchanges);

            if (best.length === 0) {
                return ctx.reply('📭 На данный момент монет, подходящих под критерии фильтра, не найдено.');
            }

            let report = '💎 *ТОП МОНЕТЫ (APR %)*\n\n';

            const c0 = 12; // COIN/PAIR
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
        } finally {
            this.isScanning = false;
        }
    }

    private getScanKeyboard(selected: string[]) {
        const all = ['Binance', 'Hyperliquid', 'Paradex', 'Lighter', 'Extended'];

        // Кнопки бирж: те, что не выбраны
        const available = all.filter(ex => !selected.includes(ex));
        const buttons = available.map(ex => Markup.button.callback(ex, `scan_toggle_${ex}`));

        const rows = [];
        if (buttons.length > 0) {
            rows.push(buttons); // Первый ряд - доступные биржи
        }

        // Второй ряд - кнопка ОК
        rows.push([Markup.button.callback('✅ ОК', 'scan_confirm')]);

        return Markup.inlineKeyboard(rows);
    }

    private getCoinExchangesKeyboard(coin: string, exchanges: string[], selected: string[]) {
        const buttons = exchanges.map(ex => {
            const isSel = selected.includes(ex);
            return Markup.button.callback(isSel ? `✅ ${ex}` : ex, `coin_sel_${ex}`);
        });

        const rows: any[][] = [];
        // Разбиваем биржи на строки по 5 штук
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(buttons.slice(i, i + 5));
        }
        // Кнопка ОК всегда отдельной строкой снизу
        rows.push([Markup.button.callback('🚀 Показать фандинг', 'coin_ok')]);

        return Markup.inlineKeyboard(rows);
    }

    private async renderComparisonTable(coin: string, ex1: string, ex2: string): Promise<string> {
        const results = await this.service.getComparison(coin, ex1, ex2);

        // Настройки ширины: Колонка 0 = 8 символов, Данные = 6 символов
        const c0 = 8;
        const cW = 6;

        const formatVal = (val: number) => {
            if (isNaN(val)) return '   NaN'.padStart(cW);
            const s = val.toFixed(1);
            return (s.length > cW ? val.toFixed(0) : s).padStart(cW);
        };

        const name1 = ex1.substring(0, c0).padEnd(c0);
        const name2 = ex2.substring(0, c0).padEnd(c0);

        let table = `💎 *${coin}*: ${ex1} 🆚 ${ex2}\n\n`;
        table += '```\n';
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

        return table;
    }

    async handleCallback(ctx: Context) {
        if (!ctx.from || !ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;

        const userId = ctx.from.id;
        const data = ctx.callbackQuery.data;

        // --- Обработка сканера ТОП-20 ---
        if (data === 'scan_all') {
            await this.runScan(ctx);
            return await ctx.answerCbQuery();
        }

        if (data === 'scan_manual') {
            scanStates.set(userId, { selected: [] });
            await ctx.editMessageText('Выберите биржи (от 1 до 5) и нажмите ОК:', this.getScanKeyboard([]));
            return await ctx.answerCbQuery();
        }

        if (data.startsWith('scan_toggle_')) {
            const ex = data.replace('scan_toggle_', '');
            const stateScan = scanStates.get(userId);
            if (!stateScan) return await ctx.answerCbQuery();

            if (!stateScan.selected.includes(ex)) {
                stateScan.selected.push(ex);
            }

            if (stateScan.selected.length === 5) {
                await ctx.editMessageText(`✅ Выбраны все биржи. Запускаю расчет...`);
                await this.runScan(ctx, stateScan.selected);
                scanStates.delete(userId);
            } else {
                const list = stateScan.selected.join(', ');
                await ctx.editMessageText(`Выбрано: ${list}\nДобавьте еще или нажмите ОК:`, this.getScanKeyboard(stateScan.selected));
            }
            return await ctx.answerCbQuery();
        }

        if (data === 'scan_confirm') {
            const stateScan = scanStates.get(userId);
            if (!stateScan || stateScan.selected.length === 0) {
                return ctx.answerCbQuery('⚠️ Выберите хотя бы одну биржу!');
            }
            await ctx.editMessageText(`✅ Запускаю расчет для: ${stateScan.selected.join(', ')}`);
            await this.runScan(ctx, stateScan.selected);
            scanStates.delete(userId);
            return await ctx.answerCbQuery();
        }

        // --- Обработка одиночного расчета монеты ---
        const state = userStates.get(userId);
        if (!state) return await ctx.answerCbQuery();

        if (data.startsWith('coin_sel_')) {
            const ex = data.replace('coin_sel_', '');
            const state = userStates.get(userId);
            if (!state) return await ctx.answerCbQuery();

            // Пользователь может выбрать только одну (радио-кнопка)
            state.selected = [ex];

            const allExchanges = await this.service.getExchangesForCoin(state.coin);
            await ctx.editMessageText(`Выбрана биржа: *${ex}*\nНажмите кнопку ниже для расчета относительно всех остальных бирж:`, {
                parse_mode: 'Markdown',
                ...this.getCoinExchangesKeyboard(state.coin, allExchanges, state.selected)
            });
            return await ctx.answerCbQuery();

        } else if (data === 'coin_ok') {
            const state = userStates.get(userId);
            if (!state || state.selected.length === 0) {
                return ctx.answerCbQuery('⚠️ Выберите биржу!');
            }

            const baseEx = state.selected[0];
            const allExchanges = await this.service.getExchangesForCoin(state.coin);
            const others = allExchanges.filter(ex => ex !== baseEx);

            if (others.length === 0) {
                await ctx.reply(`Монета ${state.coin} торгуется только на ${baseEx}. Сравнивать не с чем.`);
                userStates.delete(userId);
                return await ctx.answerCbQuery();
            }

            await ctx.editMessageText(`⏳ Генерирую отчеты для *${state.coin}* (${baseEx} vs All)...`, { parse_mode: 'Markdown' });

            for (const other of others) {
                try {
                    const table = await this.renderComparisonTable(state.coin, baseEx, other);
                    await ctx.reply(table, { parse_mode: 'Markdown' });
                } catch (err) {
                    console.error(`Error rendering table ${baseEx}-${other}:`, err);
                }
            }

            userStates.delete(userId);
            return await ctx.answerCbQuery();

        } else if (data.startsWith('calc_ex1_')) {
            // Старая логика (для совместимости, если остались сообщения в чате)
            const ex1 = data.replace('calc_ex1_', '');
            state.selected = [ex1];
            const allExchanges = await this.service.getExchangesForCoin(state.coin);
            const remaining = allExchanges.filter(ex => ex !== ex1);
            if (remaining.length === 0) {
                userStates.delete(userId);
                return await ctx.answerCbQuery();
            }
            const buttons = remaining.map(ex => Markup.button.callback(ex, `calc_ex2_${ex}`));
            await ctx.editMessageText(`Выберите вторую биржу:`, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard(buttons, { columns: 5 })
            });
            return await ctx.answerCbQuery();
        } else if (data.startsWith('calc_ex2_')) {
            const ex2 = data.replace('calc_ex2_', '');
            const ex1 = state.selected[0];
            const table = await this.renderComparisonTable(state.coin, ex1, ex2);
            await ctx.reply(table, { parse_mode: 'Markdown' });
            userStates.delete(userId);
            return await ctx.answerCbQuery();
        }

        await ctx.answerCbQuery();
    }
}
