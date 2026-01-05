import { Router, Request, Response } from 'express';
import axios from 'axios';
import { CalcFundingsService } from '../calcFundings/calc-fundings.service';
import { MasterService } from '../collector/master.service';
import { AddCoinsService } from '../addCoinsDB/add-coins.service';

const router = Router();
const calcService = new CalcFundingsService();
const masterService = MasterService.getInstance();
const addCoinsService = new AddCoinsService();

/**
 * @api {get} /api/coins Получить список всех монет
 */
router.get('/coins', async (req: Request, res: Response) => {
    try {
        const coins = await calcService.getAllCoins();
        res.json({ success: true, count: coins.length, coins });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @api {get} /api/best-opportunities Получить лучшие возможности (ТОП-30)
 * @apiParam {String} [exchanges] Список бирж через запятую (например: Binance,Paradex)
 */
router.get('/best-opportunities', async (req: Request, res: Response) => {
    try {
        const exchangesQuery = req.query.exchanges as string;
        const selectedExchanges = exchangesQuery ? exchangesQuery.split(',') : undefined;

        const best = await calcService.findBestOpportunities(selectedExchanges);
        res.json({ success: true, count: best.length, data: best });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @api {get} /api/coin/:name Получить детальные данные по монете
 * @apiParam {String} [exchanges] Список бирж через запятую для сравнения
 */
router.get('/coin/:name', async (req: Request, res: Response) => {
    try {
        const coin = req.params.name.toUpperCase();
        const exchangesQuery = req.query.exchanges as string;

        const allAvailable = await calcService.getExchangesForCoin(coin);
        if (allAvailable.length === 0) {
            return res.status(404).json({ success: false, error: `Coin ${coin} not found` });
        }

        const selected = exchangesQuery ? exchangesQuery.split(',') : allAvailable;

        // Формируем сравнения (все со всеми из выбранных)
        const comparisons = [];
        for (let i = 0; i < selected.length; i++) {
            for (let j = i + 1; j < selected.length; j++) {
                const comp = await calcService.getComparison(coin, selected[i], selected[j]);
                comparisons.push({
                    pair: `${selected[i]} vs ${selected[j]}`,
                    results: comp
                });
            }
        }

        // История для графиков (за последние 14 дней)
        const now = Date.now();
        const startTs = now - 14 * 24 * 60 * 60 * 1000;
        const histories = [];
        for (const ex of selected) {
            const h = await calcService.getHourlyHistory(ex, coin, startTs, now);
            histories.push({ exchange: ex, history: h });
        }

        res.json({
            success: true,
            coin,
            availableExchanges: allAvailable,
            selectedExchanges: selected,
            comparisons,
            histories
        });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @api {post} /api/sync/full Запустить полную синхронизацию истории фандинга
 */
router.post('/sync/full', async (req: Request, res: Response) => {
    try {
        if (masterService.getIsProcessing()) {
            return res.status(409).json({ success: false, error: 'Sync already in progress' });
        }

        const result = await masterService.syncAllExchanges();
        res.json({ success: true, message: 'Full sync completed', ...result });
    } catch (error: any) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        }
    }
});

/**
 * @api {post} /api/sync/coins Обновить список торговых пар
 */
router.post('/sync/coins', async (req: Request, res: Response) => {
    try {
        if (addCoinsService.isSyncing) {
            return res.status(409).json({ success: false, error: 'Coin sync already in progress' });
        }

        const result = await addCoinsService.syncAllPairs();
        res.json({ success: true, message: 'Coin sync completed', ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
