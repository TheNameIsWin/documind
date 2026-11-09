import { Router } from 'express';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { validateBody } from '../middleware/validate.js';

export const ChatRequestSchema = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(8000) }))
    .max(20)
    .default([]),
  documentIds: z.array(z.string()).max(100).optional(),
  topK: z.number().int().min(1).max(20).optional(),
  stream: z.boolean().default(true),
});

type ChatRequest = z.infer<typeof ChatRequestSchema>;

export function chatRouter({ rag }: Container): Router {
  const router = Router();

  router.post('/', validateBody(ChatRequestSchema), async (req, res, next) => {
    const body = req.body as ChatRequest;

    if (!body.stream) {
      try {
        return res.json(await rag.answer(body));
      } catch (err) {
        return next(err);
      }
    }

    // ---- Server-Sent Events ----
    const controller = new AbortController();
    // Stop generating (and paying for tokens) as soon as the client goes away.
    res.on('close', () => controller.abort());

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      for await (const event of rag.ask({ ...body, signal: controller.signal })) {
        if (controller.signal.aborted) break;
        const { type, ...payload } = event;
        send(type, payload);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        req.log.error({ err }, 'Chat stream failed');
        send('error', { message: err instanceof Error ? err.message : 'Generation failed' });
      }
    } finally {
      res.end();
    }
  });

  return router;
}
