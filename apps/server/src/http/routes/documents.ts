import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import type { Container } from '../../container.js';
import { AppError } from '../../lib/errors.js';
import { validateBody } from '../middleware/validate.js';

const TextDocumentSchema = z.object({
  name: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(2_000_000),
});

export function documentsRouter({ ingestion, store, env }: Container): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  router.get('/', (_req, res) => {
    res.json({ documents: store.listDocuments() });
  });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw AppError.badRequest('Expected a multipart "file" field');
      // Multer decodes filenames as latin1; restore UTF-8 names.
      const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const doc = await ingestion.ingest({
        filename,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
      });
      req.log.info({ documentId: doc.id, chunks: doc.chunkCount }, 'Document ingested');
      res.status(201).json({ document: doc });
    } catch (err) {
      next(err);
    }
  });

  router.post('/text', validateBody(TextDocumentSchema), async (req, res, next) => {
    try {
      const { name, text } = req.body as z.infer<typeof TextDocumentSchema>;
      const doc = await ingestion.ingestText(name, text);
      res.status(201).json({ document: doc });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', (req, res, next) => {
    const doc = store.getDocument(req.params.id);
    if (!doc) return next(AppError.notFound('Document not found'));
    const chunks = store.getChunks(doc.id).map(({ embedding: _embedding, ...chunk }) => chunk);
    res.json({ document: doc, chunks });
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const deleted = await store.deleteDocument(req.params.id);
      if (!deleted) throw AppError.notFound('Document not found');
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
