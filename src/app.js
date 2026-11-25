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

/** Monta a aplicação Express. Recebe config e banco já prontos (facilita testes). */
export function createApp({ config, db }) {
  const app = express();
  const sessions = createSessionStore(db, config);

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'script-src': ["'self'"],
          'style-src': ["'self'", 'https://fonts.googleapis.com'],
          'font-src': ['https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          // Em desenvolvimento (http://localhost) o upgrade para HTTPS quebraria o carregamento.
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  if (config.logFormat) app.use(morgan(config.logFormat));
  app.use(cookieParser());
  app.use(express.json({ limit: '10kb' }));
  app.use(sameOriginOnly(config.allowedOrigins));
  app.use(loadUser(sessions));

  // ---- API ----
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/health', healthRouter(db));
  app.use('/api/auth', authRouter({ db, config, sessions }));
  app.use('/api/admin', adminRouter({ db }));
  app.use('/api/materials', materialsRouter({ db, config }));
  app.use('/api/communities', communitiesRouter({ db, config }));
  app.use('/api/feedback', feedbackRouter({ db, config }));
  app.use('/api/profile', profileRouter({ db }));
  app.use('/api/notifications', notificationsRouter({ db }));
  app.use('/api', apiNotFound);

  // ---- Front-end estático ----
  app.use(
    express.static(config.publicDir, {
      extensions: ['html'],
      setHeaders(res, file) {
        const isImage = /\.(png|jpe?g|svg|ico|webp)$/i.test(file);
        res.set('Cache-Control', isImage ? 'public, max-age=604800' : 'no-cache');
      },
    }),
  );

  app.use(errorHandler(config));
  app.locals.sessions = sessions;
  return app;
}
