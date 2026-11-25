import { COOKIE_NAME } from '../lib/sessions.js';
import { unauthorized, forbidden } from '../lib/errors.js';

/** Anexa `req.user` quando há uma sessão válida (não bloqueia a requisição). */
export function loadUser(sessions) {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.[COOKIE_NAME];
      req.sessionToken = token;
      req.user = await sessions.find(token);
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Bloqueia com 401 quem não estiver autenticado. */
export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Bloqueia com 403 quem não for administrador (exige autenticação). */
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.is_admin) return next(forbidden('Acesso restrito a administradores.'));
  next();
}
