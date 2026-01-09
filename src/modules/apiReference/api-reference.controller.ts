import { Router, Request, Response } from 'express';
import { CalcFundingsService } from '../calcFundings/calc-fundings.service';
import { MasterService } from '../collector/master.service';
import { AddCoinsService } from '../addCoinsDB/add-coins.service';
import { prisma } from '../database/prisma.service';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';

const router = Router();
const calcService = new CalcFundingsService();
const masterService = MasterService.getInstance();
const addCoinsService = new AddCoinsService();

// Swagger configuration
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Funding Tools API',
            version: '1.0.0',
            description: 'API for funding rates monitoring and analysis',
        },
        servers: [
            {
                url: 'http://localhost:3005',
                description: 'Local development server',
            },
        ],
    },
    apis: [__filename], // Look for docs in this file
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
router.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @openapi
 * /api/health:
 *   get:
 *     summary: Проверка состояния сервера
 *     tags: [Monitoring]
 *     responses:
 *       200:
 *         description: Сервер работает корректно
 */
router.get('/health', async (req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({
            status: 'ok',
            db: 'connected',
            timestamp: new Date().toISOString(),
            isSyncing: masterService.getIsProcessing()
        });
    } catch (error: any) {
        res.status(503).json({
            status: 'error',
            db: 'disconnected',
            error: error.message
        });
    }
});

/**
 * @openapi
 * /api/presets:
 *   get:
 *     summary: Получить все пресеты фандинга
 *     tags: [Presets]
 *     responses:
 *       200:
 *         description: Список пресетов
 */
router.get('/presets', async (req: Request, res: Response) => {
    try {
        const presets = await calcService.getPresets();
        res.json({ success: true, data: presets });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/presets/{id}:
 *   put:
 *     summary: Обновить пресет фандинга
 *     tags: [Presets]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               h8: { type: number }
 *               d1: { type: number }
 *               d3: { type: number }
 *               d7: { type: number }
 *               d14: { type: number }
 *     responses:
 *       200:
 *         description: Пресет обновлен
 */
router.put('/presets/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const { h8, d1, d3, d7, d14 } = req.body;
        await calcService.updatePreset(id, { h8, d1, d3, d7, d14 });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/coins:
 *   get:
 *     summary: Получить список всех монет
 *     tags: [MarketData]
 *     responses:
 *       200:
 *         description: Список монет
 */
router.get('/coins', async (req: Request, res: Response) => {
    try {
        const coins = await calcService.getAllCoins();
        res.json({ success: true, count: coins.length, coins: coins });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/best-opportunities:
 *   get:
 *     summary: Получить лучшие возможности (сканер)
 *     tags: [Analysis]
 *     parameters:
 *       - in: query
 *         name: exchanges
 *         schema: { type: string }
 *         description: Список бирж через запятую
 *       - in: query
 *         name: presetId
 *         schema: { type: integer }
 *         description: ID пресета фильтрации
 *     responses:
 *       200:
 *         description: Список лучших пар
 */
router.get('/best-opportunities', async (req: Request, res: Response) => {
    try {
        const exchangesQuery = req.query.exchanges as string;
        const selectedExchanges = exchangesQuery ? exchangesQuery.split(',') : undefined;
        const presetId = req.query.presetId ? parseInt(req.query.presetId as string) : undefined;

        let thresholds = undefined;
        if (presetId) {
            thresholds = await calcService.getPresetById(presetId);
        }

        const best = await calcService.findBestOpportunities(selectedExchanges, thresholds);
        res.json({ success: true, count: best.length, data: best });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/coin/{name}:
 *   get:
 *     summary: Детальные данные по конкретной монете
 *     tags: [Analysis]
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: exchanges
 *         schema: { type: string }
 *         description: Биржи для сравнения
 *     responses:
 *       200:
 *         description: Детальный анализ и история
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
 * @openapi
 * /api/sync/full:
 *   post:
 *     summary: Полная синхронизация истории всех бирж
 *     tags: [Sync]
 *     responses:
 *       200:
 *         description: Синхронизация завершена
 */
router.post('/sync/full', async (req: Request, res: Response) => {
    try {
        if (masterService.getIsProcessing()) {
            return res.status(409).json({ success: false, error: 'Sync already in progress' });
        }
        const result = await masterService.syncAllExchanges();
        res.json({ success: true, ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @openapi
 * /api/sync/coins:
 *   post:
 *     summary: Обновить список пар на всех биржах
 *     tags: [Sync]
 *     responses:
 *       200:
 *         description: Список монет обновлен
 */
router.post('/sync/coins', async (req: Request, res: Response) => {
    try {
        if (addCoinsService.isSyncing) {
            return res.status(409).json({ success: false, error: 'Coin sync already in progress' });
        }
        const result = await addCoinsService.syncAllPairs();
        res.json({ success: true, ...result });
    } catch (error: any) {
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;
