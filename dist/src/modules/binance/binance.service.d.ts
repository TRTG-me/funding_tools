export declare class BinanceService {
    private readonly apiUrl;
    syncBinanceCoins(): Promise<{
        total: number;
        newCoins: number;
        updatedCoins: number;
    }>;
}
