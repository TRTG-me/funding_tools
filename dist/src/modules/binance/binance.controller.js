"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceController = void 0;
const binance_service_1 = require("./binance.service");
class BinanceController {
    constructor() {
        this.binanceService = new binance_service_1.BinanceService();
    }
    async handleSync(ctx) {
        try {
            await ctx.reply('⏳ Начинаю синхронизацию с Binance...');
            const result = await this.binanceService.syncBinanceCoins();
            await ctx.reply(`✅ Синхронизация завершена!\n\n` +
                `📊 Всего монет: ${result.total}\n` +
                `✨ Новых: ${result.newCoins}\n` +
                `🔄 Обновлено интервалов: ${result.updatedCoins}`);
        }
        catch (error) {
            await ctx.reply('❌ Ошибка при обновлении данных Binance.');
        }
    }
}
exports.BinanceController = BinanceController;
//# sourceMappingURL=binance.controller.js.map