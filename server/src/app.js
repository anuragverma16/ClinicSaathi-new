import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import routes from './routes.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  // Flat query strings only: the extended parser turns ?id[$ne]=x into a query
  // operator object, which is a query-injection vector.
  app.set('query parser', 'simple');
  app.use(helmet());
  app.use(cors({ origin: env.clientUrl, credentials: true }));
  app.use(compression());
  app.use(cookieParser());
  // Request logs carry paths only — never bodies, which may hold health data.
  if (env.nodeEnv !== 'test') app.use(morgan(':method :url :status :response-time ms'));

  // Webhook signatures are computed over raw bytes, so these routes must not
  // be JSON-parsed. They have to be registered before express.json().
  app.use('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }));
  app.use('/api/webhooks/whatsapp', express.raw({ type: '*/*', limit: '1mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300 * env.rateLimitMultiplier, standardHeaders: true }));

  app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
