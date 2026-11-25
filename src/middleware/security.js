import { HttpError } from '../lib/errors.js';

/**
 * Defesa em profundidade contra CSRF (além de SameSite=Lax no cookie):
 * em métodos que alteram dados, se o navegador enviou `Origin`, ele deve ser o próprio site.
 */
export function sameOriginOnly(allowedOrigins = []) {
  const safe = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (safe.has(req.method) || !origin) return next();
    if (origin === `${req.protocol}://${req.get('host')}` || allowedOrigins.includes(origin)) return next();
    next(new HttpError(403, 'BAD_ORIGIN', 'Origem não permitida.'));
  };
}
