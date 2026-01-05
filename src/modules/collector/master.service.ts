import { BinanceService } from '../binance/binance.service';
import { HyperliquidService } from '../hyperliquid/hyperliquid.service';
import { ParadexService } from '../paradex/paradex.service';
import { LighterService } from '../lighter/lighter.service';
import { ExtendedService } from '../extended/extended.service';

export class MasterService {
    private static instance: MasterService;
    private binance = new BinanceService();
    private hl = new HyperliquidService();
    private paradex = new ParadexService();
    private lighter = new LighterService();
    private extended = new ExtendedService();

    private isProcessing = false;

    private constructor() { }

    public static getInstance(): MasterService {
        if (!MasterService.instance) {
            MasterService.instance = new MasterService();
        }
        return MasterService.instance;
    }

    async syncAllExchanges() {
        if (this.isProcessing) {
            throw new Error('Обновление базы уже запущено.');
        }

        this.isProcessing = true;
        const startTime = Date.now();

        try {
            const results = await Promise.allSettled([
                this.binance.syncHistoricalFunding(),
                this.hl.syncHistoricalFunding(),
                this.paradex.syncHistoricalFunding(),
                this.lighter.syncHistoricalFunding(),
                this.extended.syncHistoricalFunding(),
            ]);

            const labels = ['Binance', 'Hyperliquid', 'Paradex', 'Lighter', 'Extended'];
            const report = results.map((res, index) => {
                const label = labels[index];
                if (res.status === 'fulfilled') {
                    return { label, success: true, ...res.value };
                } else {
                    return { label, success: false, error: res.reason?.message || res.reason };
                }
            });

            const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
            return { report, totalDuration };

        } catch (error: any) {
            console.error('[MasterService] Global Sync Error:', error);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    getIsProcessing() {
        return this.isProcessing;
    }
}
