import { Context, Markup } from 'telegraf';
import { CalcFundingsService } from './calc-fundings.service';

// TTL-based Map для автоматической очистки состояний через 10 минут
interface TimestampedState<T> {
    data: T;
    timestamp: number;
}

const userStates = new Map<number, TimestampedState<{ coin: string, selected: string[] }>>();
const scanStates = new Map<number, TimestampedState<{ selected: string[], mode: 'all' | 'manual' }>>();
const settingsStates = new Map<number, TimestampedState<{ candidateText?: string, editingPresetId?: number }>>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 минут

// Очистка старых состояний каждые 5 минут
setInterval(() => {
    const now = Date.now();

    for (const [userId, state] of userStates.entries()) {
        if (now - state.timestamp > STATE_TTL_MS) {
            userStates.delete(userId);
            console.log(`🧹 Cleaned expired userState for user ${userId}`);
        }
    }

    for (const [userId, state] of scanStates.entries()) {
        if (now - state.timestamp > STATE_TTL_MS) {
            scanStates.delete(userId);
            console.log(`🧹 Cleaned expired scanState for user ${userId}`);
        }
    }
}, 5 * 60 * 1000); // Каждые 5 минут

// Helper функции для работы с TTL-состояниями
function setUserState(userId: number, data: { coin: string, selected: string[] }) {
    userStates.set(userId, { data, timestamp: Date.now() });
}

function getUserState(userId: number): { coin: string, selected: string[] } | undefined {
    const entry = userStates.get(userId);
    if (!entry) return undefined;

    // Проверяем, не истек ли TTL
    if (Date.now() - entry.timestamp > STATE_TTL_MS) {
        userStates.delete(userId);
        return undefined;
    }

    // Обновляем timestamp при доступе
    entry.timestamp = Date.now();
    return entry.data;
}

function setScanState(userId: number, data: { selected: string[], mode: 'all' | 'manual' }) {
    scanStates.set(userId, { data, timestamp: Date.now() });
}

function getScanState(userId: number): { selected: string[], mode: 'all' | 'manual' } | undefined {
    const entry = scanStates.get(userId);
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > STATE_TTL_MS) {
        scanStates.delete(userId);
        return undefined;
    }

    entry.timestamp = Date.now();
    return entry.data;
}

function clearAllStates(userId: number) {
    userStates.delete(userId);
    scanStates.delete(userId);
    settingsStates.delete(userId);
}

export class CalcFundingsController {
    private service = new CalcFundingsService();

    async startFlow(ctx: Context) {
        const userId = ctx.from!.id;
        clearAllStates(userId);
        await ctx.reply('🔍 Введите название монеты (например, BTC, ETH или PEPE):');
        setUserState(userId, { coin: '', selected: [] });
    }

    async showBestOpportunities(ctx: Context) {
        const userId = ctx.from!.id;
        clearAllStates(userId);

        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('🌐 Все биржи', 'scan_mode_all')],
            [Markup.button.callback('⚙️ Ручной выбор', 'scan_mode_manual')]
        ]);

        await ctx.reply('Выберите режим сканирования:', keyboard);
    }

    // --- SETTINGS ---

    async showFundingSettings(ctx: Context) {
        const userId = ctx.from!.id;
        clearAllStates(userId);
        const presets = await this.service.getPresets();

        let text = '⚙️ *НАСТРОЙКИ ПОРОГОВ (APR %)*\n\n';
        text += '```text\n';
        text += `| P | 8h | 1d | 3d | 7d | 14d |\n`;
        text += `|---|----|----|----|----|-----|\n`;
        for (const p of presets) {
            const num = p.name.substring(7);
            text += `| ${num} | ${p.h8.toString().padStart(2)} | ${p.d1.toString().padStart(2)} | ${p.d3.toString().padStart(2)} | ${p.d7.toString().padStart(2)} | ${p.d14.toString().padStart(3)} |\n`;
        }
        text += '```\n';
        text += '💡 *Как изменить?*\n';
        text += '1. Нажмите кнопку нужного пресета ниже.\n';
        text += '2. Или отправьте всю таблицу текстом и нажмите Сохранить.';

        const pButtons = presets.map(p => Markup.button.callback(p.name.substring(7), `settings_edit_${p.id}`));

        const keyboard = Markup.inlineKeyboard([
            pButtons,
            [Markup.button.callback('✅ Сохранить таблицу', 'settings_save')],
            [Markup.button.callback('❌ Закрыть', 'settings_close')]
        ]);

        await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });
        settingsStates.set(userId, { data: {}, timestamp: Date.now() });
    }

    async handleText(ctx: Context): Promise<boolean> {
        if (!ctx.from || !ctx.message || !('text' in ctx.message)) return false;

        const userId = ctx.from.id;
        const text = ctx.message.text.trim();
        const ss = settingsStates.get(userId);

        // 1. Режим редактирования конкретно одного пресета
        if (ss && ss.data.editingPresetId) {
            const vals = text.split(/[,\s]+/).map(v => parseFloat(v));
            if (vals.length === 5 && vals.every(v => !isNaN(v))) {
                await this.service.updatePreset(ss.data.editingPresetId, {
                    h8: vals[0], d1: vals[1], d3: vals[2], d7: vals[3], d14: vals[4]
                });
                await ctx.reply(`✅ Пресет ${ss.data.editingPresetId} обновлен!`);
                clearAllStates(userId); // Глубокая очистка после завершения
                await this.showFundingSettings(ctx); // Показываем обновленную таблицу
                return true;
            } else {
                await ctx.reply('❌ Некорректный формат. Нужно 5 чисел через запятую или пробел.\nПример: 30, 30, 25, 25, 20');
                return true;
            }
        }

        // 2. Массовое редактирование через таблицу
        if (text.includes('| P |') && text.includes('| 8h |')) {
            settingsStates.set(userId, { data: { candidateText: text }, timestamp: Date.now() });
            await ctx.reply('📥 Данные всей таблицы получены. Нажмите "Сохранить таблицу" выше для применения.');
            return true;
        }

        const state = getUserState(userId);
        if (!state || state.coin !== '') return false;

        const coin = ctx.message.text.trim().toUpperCase();
        if (coin.length > 20) {
            await ctx.reply('⚠️ Название монеты слишком длинное (макс. 20 символов).');
            return true;
        }

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

    private async showPresetSelection(ctx: Context, mode: 'all' | 'manual') {
        const presets = await this.service.getPresets();

        let text = `🎯 *ВЫБОР ФИЛЬТРА (${mode === 'all' ? 'Все биржи' : 'Ручной выбор'})*\n\n`;
        text += '```text\n';
        text += `| P | 8h | 1d | 3d | 7d | 14d |\n`;
        text += `|---|----|----|----|----|-----|\n`;
        for (const p of presets) {
            const num = p.name.substring(7);
            text += `| ${num} | ${p.h8.toString().padStart(2)} | ${p.d1.toString().padStart(2)} | ${p.d3.toString().padStart(2)} | ${p.d7.toString().padStart(2)} | ${p.d14.toString().padStart(3)} |\n`;
        }
        text += '```\n';
        text += 'Выберите кнопку соответствующего пресета:';

        const buttons = presets.map(p => Markup.button.callback(p.name.substring(7), `scan_preset_${p.id}_${mode}`));
        const keyboard = Markup.inlineKeyboard([buttons]);

        await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
    }

    private async runScan(ctx: Context, presetId: number, selectedExchanges?: string[]) {
        if (this.isScanning) {
            return ctx.reply('⚠️ Сканер уже запущен. Пожалуйста, подождите завершения предыдущего поиска.');
        }

        try {
            this.isScanning = true;
            const preset = await this.service.getPresetById(presetId);
            if (!preset) throw new Error('Preset not found');

            await ctx.reply(`⏳ Запускаю сканер лучших возможностей...\nПресет: *${preset.name}*\nЭто может занять 15-30 секунд.`, { parse_mode: 'Markdown' });

            const best = await this.service.findBestOpportunities(selectedExchanges, preset);

            if (best.length === 0) {
                return ctx.reply('📭 На данный момент монет, подходящих под критерии фильтра, не найдено.');
            }

            let report = '💎 *ТОП МОНЕТЫ (APR %)*\n\n';

            const c0 = 12; // COIN/PAIR
            const cW = 5;  // DATA

            let table = '```text\n';
            table += `┌${'─'.repeat(c0)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┬${'─'.repeat(cW)}┐\n`;
            table += `│${'COIN (P)'.padEnd(c0)}│${'8h'.padStart(cW)}│${'1d'.padStart(cW)}│${'3d'.padStart(cW)}│${'7d'.padStart(cW)}│${'14d'.padStart(cW)}│\n`;
            table += `├${'─'.repeat(c0)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┼${'─'.repeat(cW)}┤\n`;

            for (const item of best.slice(0, 30)) {
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
            // Гарантированно освобождаем блокировку, даже если произошла ошибка
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
        // Оставляем только те кнопки, которые еще НЕ выбраны
        const available = exchanges.filter(ex => !selected.includes(ex));

        const buttons = available.map(ex => {
            return Markup.button.callback(ex, `coin_sel_${ex}`);
        });

        const rows: any[][] = [];
        for (let i = 0; i < buttons.length; i += 5) {
            rows.push(buttons.slice(i, i + 5));
        }

        // Кнопка ОК всегда отдельной строкой снизу
        rows.push([Markup.button.callback('✅ ОК', 'coin_ok')]);

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
        table += '```text\n';
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
        if (data === 'scan_mode_all') {
            await this.showPresetSelection(ctx, 'all');
            return await ctx.answerCbQuery();
        }

        if (data === 'scan_mode_manual') {
            setScanState(userId, { selected: [], mode: 'manual' });
            await ctx.editMessageText('Выберите биржи (от 1 до 5) и нажмите ОК:', this.getScanKeyboard([]));
            return await ctx.answerCbQuery();
        }

        if (data.startsWith('scan_toggle_')) {
            const ex = data.replace('scan_toggle_', '');
            const stateScan = getScanState(userId);
            if (!stateScan) return await ctx.answerCbQuery('⚠️ Сессия сканирования истекла. Нажмите "Лучшие монеты" снова.', { show_alert: true });

            if (!stateScan.selected.includes(ex)) {
                stateScan.selected.push(ex);
            }

            const list = stateScan.selected.join(', ');
            await ctx.editMessageText(`Выбрано: ${list}\nДобавьте еще или нажмите ОК:`, this.getScanKeyboard(stateScan.selected));
            return await ctx.answerCbQuery();
        }

        if (data.startsWith('scan_preset_')) {
            const parts = data.split('_');
            const presetId = parseInt(parts[2]);
            const mode = parts[3];

            if (mode === 'all') {
                await this.runScan(ctx, presetId);
            } else {
                const stateScan = getScanState(userId);
                if (stateScan) {
                    await this.runScan(ctx, presetId, stateScan.selected);
                } else {
                    return await ctx.answerCbQuery('⚠️ Сессия истекла. Начните выбор заново.', { show_alert: true });
                }
            }
            return await ctx.answerCbQuery();
        }

        if (data === 'scan_confirm') {
            const stateScan = getScanState(userId);
            if (!stateScan) return await ctx.answerCbQuery('⚠️ Сессия истекла. Нажмите "Лучшие монеты" снова.', { show_alert: true });

            if (stateScan.selected.length === 0) {
                return ctx.answerCbQuery('⚠️ Выберите хотя бы одну биржу!');
            }
            await this.showPresetSelection(ctx, 'manual');
            return await ctx.answerCbQuery();
        }

        if (data === 'settings_close') {
            await ctx.deleteMessage().catch(() => { });
            settingsStates.delete(userId);
            return await ctx.answerCbQuery();
        }

        if (data.startsWith('settings_edit_')) {
            const id = parseInt(data.replace('settings_edit_', ''));
            const p = await this.service.getPresetById(id);
            if (!p) return await ctx.answerCbQuery();

            settingsStates.set(userId, { data: { editingPresetId: id }, timestamp: Date.now() });
            await ctx.reply(`✏️ Редактируем *${p.name}*\nТекущие: ${p.h8}, ${p.d1}, ${p.d3}, ${p.d7}, ${p.d14}\n\nВведите 5 новых значений через запятую:`, { parse_mode: 'Markdown' });
            return await ctx.answerCbQuery();
        }

        if (data === 'settings_save') {
            const ss = settingsStates.get(userId);
            if (!ss || !ss.data.candidateText) {
                return ctx.answerCbQuery('⚠️ Сначала отправьте отредактированную таблицу текстом!');
            }

            try {
                const lines = ss.data.candidateText.split('\n').filter(l => l.includes('| Preset ') || (l.startsWith('| Preset') && l.includes('| 8h |')) === false && l.includes('|'));
                // Пропускаем заголовок и разделитель
                const dataLines = lines.filter(l => l.toLowerCase().includes('preset') && !l.includes('8h'));

                const dbPresets = await this.service.getPresets();

                for (const line of dataLines) {
                    const cells = line.split('|').map(c => c.trim()).filter(c => c.length > 0);
                    if (cells.length < 6) continue;

                    const name = cells[0];
                    const h8 = parseFloat(cells[1]);
                    const d1 = parseFloat(cells[2]);
                    const d3 = parseFloat(cells[3]);
                    const d7 = parseFloat(cells[4]);
                    const d14 = parseFloat(cells[5]);

                    const existing = dbPresets.find(p => p.name.toLowerCase() === name.toLowerCase());
                    if (existing) {
                        await this.service.updatePreset(existing.id, { h8, d1, d3, d7, d14 });
                    }
                }

                await ctx.editMessageText('✅ Настройки успешно сохранены в базе данных!');
                settingsStates.delete(userId);
            } catch (e: any) {
                await ctx.reply('❌ Ошибка парсинга таблицы: ' + e.message);
            }
            return await ctx.answerCbQuery();
        }

        // --- Обработка одиночного расчета монеты ---
        if (data.startsWith('coin_sel_') || data === 'coin_ok') {
            const state = getUserState(userId);
            if (!state) return await ctx.answerCbQuery('⚠️ Сессия анализа истекла. Напишите монету снова.', { show_alert: true });
        }

        if (data.startsWith('coin_sel_')) {
            const ex = data.replace('coin_sel_', '');
            const state = getUserState(userId);
            if (!state) return await ctx.answerCbQuery();

            // Добавляем выбор (мультиселект)
            if (!state.selected.includes(ex)) {
                state.selected.push(ex);
            }

            const allExchanges = await this.service.getExchangesForCoin(state.coin);
            const list = state.selected.join(', ');

            await ctx.editMessageText(`Выбрано: *${list}*\nВыберите еще биржи или нажмите ОК:`, {
                parse_mode: 'Markdown',
                ...this.getCoinExchangesKeyboard(state.coin, allExchanges, state.selected)
            });
            return await ctx.answerCbQuery();

        } else if (data === 'coin_ok') {
            const state = getUserState(userId);
            if (!state || state.selected.length === 0) {
                return ctx.answerCbQuery('⚠️ Выберите хотя бы одну биржу!');
            }

            const allExchanges = await this.service.getExchangesForCoin(state.coin);
            let pairs: [string, string][] = [];

            if (state.selected.length === 1) {
                // Если выбрана 1 биржа - она против всех остальных
                const baseEx = state.selected[0];
                const others = allExchanges.filter(ex => ex !== baseEx);
                others.forEach(other => pairs.push([baseEx, other]));
            } else {
                // Если выбрано 2 и более - сравнение только внутри этого списка (все со всеми)
                for (let i = 0; i < state.selected.length; i++) {
                    for (let j = i + 1; j < state.selected.length; j++) {
                        pairs.push([state.selected[i], state.selected[j]]);
                    }
                }
            }

            if (pairs.length === 0) {
                await ctx.reply(`Монета ${state.coin} торгуется только на ${state.selected[0]}. Сравнивать не с чем.`);
                userStates.delete(userId);
                return await ctx.answerCbQuery();
            }

            await ctx.editMessageText(`⏳ Формирую отчеты и общий график...`, { parse_mode: 'Markdown' });

            const now = Date.now();
            const startTs = now - 14 * 24 * 60 * 60 * 1000;

            const allPossible = ['Binance', 'Hyperliquid', 'Paradex', 'Lighter', 'Extended'];
            const targetExchanges = state.selected.length === 1 ? allPossible : state.selected;

            // Собираем истории для всех бирж, которые пойдут на ОДИН график
            const historyData: { label: string, history: any[] }[] = [];
            for (const ex of targetExchanges) {
                const h = await this.service.getHourlyHistory(ex, state.coin, startTs, now);
                if (h.length > 0) {
                    historyData.push({ label: ex, history: h });
                }
            }

            // Выводим таблицы по парам (как раньше)
            for (const [e1, e2] of pairs) {
                try {
                    const table = await this.renderComparisonTable(state.coin, e1, e2);
                    await ctx.reply(table, { parse_mode: 'Markdown' });
                    // Микро-пауза чтобы не ловить 429 от Telegram
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (err) {
                    console.error(`Error rendering table ${e1}-${e2}:`, err);
                }
            }

            // В конце выводим ОДИН общий график
            if (historyData.length > 0) {
                try {
                    const buffer = await this.service.generateMultiChart(state.coin, historyData);
                    await ctx.replyWithPhoto({ source: buffer });
                } catch (err) {
                    console.error(`Error generating multi-chart:`, err);
                }
            }

            userStates.delete(userId);
            return await ctx.answerCbQuery();

        } else if (data.startsWith('calc_ex1_')) {
            const state = getUserState(userId);
            if (!state) return await ctx.answerCbQuery('⚠️ Сессия истекла.', { show_alert: true });
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
            const state = getUserState(userId);
            if (!state) return await ctx.answerCbQuery('⚠️ Сессия истекла.', { show_alert: true });
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
