import { Router } from 'express';

export function healthRouter(db) {
  const router = Router();
  router.get('/', async (_req, res) => {
    await db.get('SELECT 1');
    res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
  });
  return router;
}
