import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { loadUser } from './middleware/auth.js';
import { sameOriginOnly } from './middleware/security.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { createSessionStore } from './lib/sessions.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { communitiesRouter } from './routes/communities.js';
import { feedbackRouter } from './routes/feedback.js';
import { healthRouter } from './routes/health.js';
import { materialsRouter } from './routes/materials.js';
import { profileRouter } from './routes/profile.js';
import { notificationsRouter } from './routes/notifications.js';
import { aiRouter } from './routes/ai.js';

/** Monta a aplicação Express. Recebe config e banco já prontos (facilita testes). */
export function createApp({ config, db, mailer }) {
  const app = express();
  const sessions = createSessionStore(db, config);

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // esm.sh = Supabase client; vlibras.gov.br + jsdelivr = widget VLibras (gov redireciona ao CDN)
          'script-src': [
            "'self'",
            'https://esm.sh',
            'https://vlibras.gov.br',
            'https://cdn.jsdelivr.net',
            // Unity WebGL do avatar VLibras (mais restrito que unsafe-eval)
            "'wasm-unsafe-eval'",
          ],
                    // CSS do site + Google Fonts + widget VLibras.
          // 'unsafe-inline' só em style-src: o VLibras injeta <style> no DOM (risco bem menor que em script-src).
          'style-src': [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
            'https://vlibras.gov.br',
            'https://cdn.jsdelivr.net',
          ],
          // fontes do Google + possíveis assets tipográficos do VLibras
          'font-src': ['https://fonts.gstatic.com', 'https://vlibras.gov.br', 'https://cdn.jsdelivr.net'],
          // Supabase storage + avatares/ícones do VLibras
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://*.supabase.co',
            'https://vlibras.gov.br',
            'https://cdn.jsdelivr.net',
          ],
          // API própria, Supabase e recursos do widget VLibras
          'connect-src': [
            "'self'",
            'https://*.supabase.co',
            'https://vlibras.gov.br',
            'https://cdn.jsdelivr.net',
          ],
          // iframe interno do player VLibras
          'frame-src': ['https://vlibras.gov.br'],
          // Unity WebGL do avatar VLibras pode precisar de workers e wasm
          'worker-src': ["'self'", 'blob:', 'https://vlibras.gov.br', 'https://cdn.jsdelivr.net'],
          'media-src': ["'self'", 'blob:', 'https://vlibras.gov.br', 'https://cdn.jsdelivr.net'],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  if (config.logFormat) app.use(morgan(config.logFormat));
  // ---- Front-end estático ----
  // Fica ANTES do cookie/JSON/sessão: arquivos estáticos não precisam consultar o banco
  // (antes, cada .js/.css/.html fazia uma consulta de sessão à toa).
  // O CDN da Vercel guarda a cópia (s-maxage) e é limpo a cada novo deploy.
  app.use(
    express.static(config.publicDir, {
      extensions: ['html'],
      setHeaders(res, file) {
        if (/\.(png|jpe?g|svg|ico|webp)$/i.test(file)) {
          res.set('Cache-Control', 'public, max-age=604800');
        } else if (/\.(js|css)$/i.test(file)) {
          res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
        } else {
          res.set('Cache-Control', 'public, max-age=0, s-maxage=300, must-revalidate');
        }
      },
    }),
  );

  app.use(cookieParser());
  
  // ATUALIZADO: Aumentado para 10mb (suficiente para o JSON com os links)
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  app.use(sameOriginOnly(config.allowedOrigins));
  app.use(loadUser(sessions));

  // ---- API ----
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/health', healthRouter(db));
  app.use('/api/auth', authRouter({ db, config, sessions, mailer }));
  app.use('/api/admin', adminRouter({ db }));
  app.use('/api/materials', materialsRouter({ db, config }));
  app.use('/api/communities', communitiesRouter({ db, config }));
  app.use('/api/feedback', feedbackRouter({ db, config }));
  app.use('/api/profile', profileRouter({ db }));
  app.use('/api/notifications', notificationsRouter({ db }));
  app.use('/api/ai', aiRouter({ db, config }));
  app.use('/api', apiNotFound);

  app.use(errorHandler(config));
  app.locals.sessions = sessions;
  app.locals.db = db;
  return app;
}