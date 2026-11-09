import { readFile } from 'node:fs/promises';
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadEnv } from '../src/config/env.js';
import { createContainer } from '../src/container.js';
import { createLogger } from '../src/lib/logger.js';
import { HANDBOOK } from './fixtures.js';

let app: Express;

beforeEach(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CHUNK_SIZE: '300',
    CHUNK_OVERLAP: '50',
  });
  const container = await createContainer(env, createLogger('silent', false), { persist: false });
  app = createApp(container);
});

const upload = () =>
  request(app).post('/api/documents').attach('file', Buffer.from(HANDBOOK), 'handbook.md');

function parseSse(body: string) {
  return body
    .trim()
    .split('\n\n')
    .map((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return { event, data: data ? JSON.parse(data) : undefined };
    });
}

describe('operational endpoints', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /ready reports providers', async () => {
    const res = await request(app).get('/ready');
    expect(res.body).toMatchObject({
      status: 'ready',
      embeddings: 'local-hash',
      llm: 'extractive',
    });
  });

  it('propagates request ids', async () => {
    const res = await request(app).get('/health').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });
});

describe('documents API', () => {
  it('uploads, lists, inspects and deletes a document', async () => {
    const created = await upload();
    expect(created.status).toBe(201);
    const { id, chunkCount } = created.body.document;
    expect(chunkCount).toBeGreaterThan(1);

    const list = await request(app).get('/api/documents');
    expect(list.body.documents).toHaveLength(1);

    const detail = await request(app).get(`/api/documents/${id}`);
    expect(detail.body.chunks).toHaveLength(chunkCount);
    expect(detail.body.chunks[0]).not.toHaveProperty('embedding');

    expect((await request(app).delete(`/api/documents/${id}`)).status).toBe(204);
    expect((await request(app).get(`/api/documents/${id}`)).status).toBe(404);
  });

  it('extracts and answers from a multi-page PDF', async () => {
    const pdf = await readFile(new URL('./assets/refund-policy.pdf', import.meta.url));
    const created = await request(app)
      .post('/api/documents')
      .attach('file', pdf, 'refund-policy.pdf');
    expect(created.status).toBe(201);

    const res = await request(app)
      .post('/api/chat')
      .send({ question: 'Which orders ship free?', stream: false });
    expect(res.body.answer).toContain('999 rupees');
  });

  it('rejects a corrupt PDF with a 400, not a 500', async () => {
    const res = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('%PDF-1.4 garbage'), 'broken.pdf');
    expect(res.status).toBe(400);
  });

  it('accepts raw text', async () => {
    const res = await request(app)
      .post('/api/documents/text')
      .send({ name: 'notes', text: 'Hello there, world.' });
    expect(res.status).toBe(201);
    expect(res.body.document.name).toBe('notes.txt');
  });

  it('rejects unsupported file types', async () => {
    const res = await request(app)
      .post('/api/documents')
      .attach('file', Buffer.from('MZ'), 'virus.exe');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a missing file', async () => {
    const res = await request(app).post('/api/documents');
    expect(res.status).toBe(400);
  });
});

describe('chat API', () => {
  it('returns a grounded JSON answer when stream=false', async () => {
    await upload();
    const res = await request(app)
      .post('/api/chat')
      .send({ question: 'How long do engineers have to acknowledge pages?', stream: false });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('15 minutes');
    expect(res.body.citations[0]).toMatchObject({ ref: 1, documentName: 'handbook.md' });
  });

  it('streams Server-Sent Events', async () => {
    await upload();
    const res = await request(app)
      .post('/api/chat')
      .send({ question: 'What does ERR_4012 mean?' })
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString()));
        r.on('end', () => cb(null, data));
      });

    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = parseSse(res.body as string);
    expect(events[0]?.event).toBe('citations');
    expect(events.some((e) => e.event === 'token')).toBe(true);
    const done = events.at(-1);
    expect(done?.event).toBe('done');
    expect(done?.data.answer).toContain('payment provider');
  });

  it('validates the request body', async () => {
    const res = await request(app).post('/api/chat').send({ question: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].path).toBe('question');
  });

  it('handles malformed JSON', async () => {
    const res = await request(app)
      .post('/api/chat')
      .set('content-type', 'application/json')
      .send('{"question":');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv({}).TOP_K).toBe(5);
  });

  it('requires an API key for OpenAI providers', () => {
    expect(() => loadEnv({ LLM_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('rejects overlap >= chunk size', () => {
    expect(() => loadEnv({ CHUNK_SIZE: '200', CHUNK_OVERLAP: '200' })).toThrow();
  });
});
