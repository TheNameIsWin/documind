import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Container } from './container.js';
import { errorHandler, notFound } from './http/middleware/error-handler.js';
import { chatRouter } from './http/routes/chat.js';
import { documentsRouter } from './http/routes/documents.js';

export function createApp(container: Container): Express {
  const { env, logger, store, embeddings, llm } = container;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string) || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()) }));
  app.use(express.json({ limit: '3mb' }));

  // ---- Operational endpoints ----
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (_req, res) =>
    res.json({
      status: 'ready',
      embeddings: embeddings.name,
      llm: llm.name,
      documents: store.listDocuments().length,
      uptimeSeconds: Math.round(process.uptime()),
    }),
  );

  // ---- API ----
  const chatLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.NODE_ENV === 'test' ? 1000 : 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });

  app.use('/api/documents', documentsRouter(container));
  app.use('/api/chat', chatLimiter, chatRouter(container));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
