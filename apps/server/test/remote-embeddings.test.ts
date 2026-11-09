import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaEmbeddings, OpenAIEmbeddings } from '../src/core/embeddings/remote.js';
import { jsonResponse, mockFetch, sentBody, sentHeaders, textResponse } from './http-mocks.js';

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const texts = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

/** Fake OpenAI /embeddings server that answers any batch size. */
function openAiEcho() {
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(String(init.body)) as { input: string[] };
    return jsonResponse({ data: input.map((_, index) => ({ index, embedding: [1, 0] })) });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenAIEmbeddings', () => {
  const embedder = () =>
    new OpenAIEmbeddings({
      apiKey: 'test-key',
      baseUrl: 'https://llm.test/v1',
      model: 'embed-test',
    });

  it('is named after its model, which stamps the vector index', () => {
    expect(embedder().name).toBe('openai:embed-test');
  });

  it('calls /embeddings with auth, model and inputs', async () => {
    const fetch = mockFetch(jsonResponse({ data: [{ index: 0, embedding: [1, 0] }] }));

    await embedder().embed(['hello']);

    expect(fetch.mock.calls[0]![0]).toBe('https://llm.test/v1/embeddings');
    expect(sentHeaders(fetch).authorization).toBe('Bearer test-key');
    expect(sentBody(fetch)).toEqual({ model: 'embed-test', input: ['hello'] });
  });

  it('re-orders results by `index` (the API does not guarantee order)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            { index: 2, embedding: [0, 0, 5] },
            { index: 0, embedding: [5, 0, 0] },
            { index: 1, embedding: [0, 5, 0] },
          ],
        }),
      ),
    );

    const vectors = await embedder().embed(['a', 'b', 'c']);

    expect(vectors).toEqual([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('L2-normalizes vectors so cosine similarity is a plain dot product', async () => {
    mockFetch(jsonResponse({ data: [{ index: 0, embedding: [3, 4] }] }));

    const [v] = await embedder().embed(['x']);

    expect(v).toEqual([0.6, 0.8]);
    expect(norm(v!)).toBeCloseTo(1, 10);
  });

  it('splits large inputs into batches of 96 and keeps global order', async () => {
    const fetch = openAiEcho();

    const vectors = await embedder().embed(texts(200));

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map((_, i) => (sentBody(fetch, i).input as string[]).length)).toEqual([
      96, 96, 8,
    ]);
    expect((sentBody(fetch, 2).input as string[])[0]).toBe('t192');
    expect(vectors).toHaveLength(200);
  });

  it('makes no network call for an empty input', async () => {
    const fetch = mockFetch();

    await expect(embedder().embed([])).resolves.toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails the whole call if any batch fails (no silently missing vectors)', async () => {
    mockFetch(
      jsonResponse({ data: texts(96).map((_, index) => ({ index, embedding: [1] })) }),
      textResponse('invalid input', 400),
    );

    await expect(embedder().embed(texts(100))).rejects.toMatchObject({ status: 502 });
  });
});

describe('OllamaEmbeddings', () => {
  const embedder = () =>
    new OllamaEmbeddings({ baseUrl: 'http://ollama.test:11434', model: 'nomic-test' });

  it('calls /api/embed with the model and inputs', async () => {
    const fetch = mockFetch(jsonResponse({ embeddings: [[0, 2]] }));

    const vectors = await embedder().embed(['hello']);

    expect(fetch.mock.calls[0]![0]).toBe('http://ollama.test:11434/api/embed');
    expect(sentBody(fetch)).toEqual({ model: 'nomic-test', input: ['hello'] });
    expect(vectors).toEqual([[0, 1]]);
  });

  it('batches by 32 (local models have small context windows)', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { input } = JSON.parse(String(init.body)) as { input: string[] };
      return jsonResponse({ embeddings: input.map(() => [1, 1]) });
    });
    vi.stubGlobal('fetch', fetch);

    const vectors = await embedder().embed(texts(70));

    expect(fetch.mock.calls.map((_, i) => (sentBody(fetch, i).input as string[]).length)).toEqual([
      32, 32, 6,
    ]);
    expect(vectors).toHaveLength(70);
  });

  it('leaves an all-zero vector untouched instead of producing NaN', async () => {
    mockFetch(jsonResponse({ embeddings: [[0, 0, 0]] }));

    expect(await embedder().embed(['empty'])).toEqual([[0, 0, 0]]);
  });
});
