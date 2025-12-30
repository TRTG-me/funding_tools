"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BinanceService = void 0;
const axios_1 = __importDefault(require("axios"));
const prisma_service_1 = require("../database/prisma.service");
class BinanceService {
    constructor() {
        this.apiUrl = 'https://fapi.binance.com/fapi/v1/fundingInfo';
    }
    async syncBinanceCoins() {
        try {
            const { data } = await axios_1.default.get(this.apiUrl);
            let newCoins = 0;
            let updatedCoins = 0;
            for (const item of data) {
                const existing = await prisma_service_1.prisma.binanceCoin.findUnique({
                    where: { coin: item.symbol }
                });
                if (!existing) {
                    // Если монеты нет - создаем
                    await prisma_service_1.prisma.binanceCoin.create({
                        data: {
                            coin: item.symbol,
                            interval: item.fundingIntervalHours
                        }
                    });
                    newCoins++;
                }
                else if (existing.interval !== item.fundingIntervalHours) {
                    // Если есть, но интервал изменился - обновляем
                    await prisma_service_1.prisma.binanceCoin.update({
                        where: { coin: item.symbol },
                        data: { interval: item.fundingIntervalHours }
                    });
                    updatedCoins++;
                }
            }
            return { total: data.length, newCoins, updatedCoins };
        }
        catch (error) {
            console.error('Binance Sync Error:', error);
            throw error;
        }
    }
}
exports.BinanceService = BinanceService;
//# sourceMappingURL=binance.service.js.map