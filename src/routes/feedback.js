import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { parse, schemas } from '../lib/validation.js';
import { requireAuth } from '../middleware/auth.js';
import { forbidden } from '../lib/errors.js';

const MINE_LIMIT = 20;

// Mesmo formato dos outros recursos (sem milissegundos): 2026-11-13T17:54:52Z
const toIso = (date) => new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');

const toApi = (row) => ({
  id: row.id,
  rating: row.rating,
  category: row.category,
  area: row.area,
  message: row.message,
  allowContact: row.allow_contact,
  createdAt: toIso(row.created_at),
});

export function feedbackRouter({ db, config }) {
  const router = Router();

  // Limite por usuário (não por IP): evita spam sem punir quem divide a mesma rede (ex.: laboratório da faculdade).
  const sendLimiter = config.rateLimit.enabled
    ? rateLimit({
        windowMs: 10 * 60 * 1000,
        limit: 5,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        keyGenerator: (req) => `user-${req.user.id}`,
        message: {
          error: {
            code: 'RATE_LIMITED',
            message: 'Você enviou vários feedbacks seguidos. Aguarde alguns minutos para enviar outro.',
          },
        },
      })
    : (_req, _res, next) => next();

  router.use(requireAuth);

  /** Envia um feedback. Administradores não enviam — só visualizam no dashboard. */
  router.post('/', sendLimiter, async (req, res) => {
    if (req.user.is_admin) {
      throw forbidden('Contas administrativas não enviam feedback. Veja as avaliações no Dashboard.');
    }
    const { rating, category, area, message, allowContact } = parse(schemas.feedback, req.body);
    const row = await db.get(
      `INSERT INTO feedback (user_id, rating, category, area, message, allow_contact)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, rating, category, area, message, allow_contact, created_at`,
      [req.user.id, rating, category, area, message, allowContact],
    );
    res.status(201).json({ item: toApi(row) });
  });

  /** Feedbacks enviados pelo próprio usuário (mais recentes primeiro). Cada um vê só os seus. */
  router.get('/mine', async (req, res) => {
    const rows = await db.all(
      `SELECT id, rating, category, area, message, allow_contact, created_at
         FROM feedback
        WHERE user_id = $1
        ORDER BY id DESC
        LIMIT ${MINE_LIMIT}`,
      [req.user.id],
    );
    res.json({ items: rows.map(toApi) });
  });

  return router;
}
