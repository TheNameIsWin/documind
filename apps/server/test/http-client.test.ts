import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/lib/errors.js';
import { fetchJson, streamLines } from '../src/lib/http-client.js';
import {
  collect,
  jsonResponse,
  mockFetch,
  sentBody,
  sentHeaders,
  streamResponse,
  textResponse,
} from './http-mocks.js';

const URL_ = 'https://upstream.test/v1/embeddings';

describe('fetchJson', () => {
  beforeEach(() => {
    // Only fake setTimeout so backoff sleeps are instant; AbortSignal.timeout keeps real timers.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    vi.spyOn(Math, 'random').mockReturnValue(0); // remove jitter => deterministic delays
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('happy path', () => {
    it('POSTs JSON and returns the parsed body', async () => {
      const fetch = mockFetch(jsonResponse({ ok: 1 }));

      await expect(fetchJson(URL_, { body: { input: ['a'] } })).resolves.toEqual({ ok: 1 });

      expect(fetch).toHaveBeenCalledTimes(1);
      const init = fetch.mock.calls[0]![1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(sentBody(fetch)).toEqual({ input: ['a'] });
      expect(sentHeaders(fetch)['content-type']).toBe('application/json');
    });

    it('lets callers add headers without losing the JSON content-type', async () => {
      const fetch = mockFetch(jsonResponse({}));

      await fetchJson(URL_, { headers: { authorization: 'Bearer test-key' }, body: {} });

      expect(sentHeaders(fetch)).toMatchObject({
        authorization: 'Bearer test-key',
        'content-type': 'application/json',
      });
    });

    it('sends no body for GET requests', async () => {
      const fetch = mockFetch(jsonResponse({}));

      await fetchJson(URL_, { method: 'GET' });

      expect((fetch.mock.calls[0]![1] as RequestInit).body).toBeUndefined();
    });

    it('attaches an abort signal so a hung upstream cannot block forever', async () => {
      const fetch = mockFetch(jsonResponse({}));

      await fetchJson(URL_, { body: {} });

      expect((fetch.mock.calls[0]![1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('retries', () => {
    it.each([429, 500, 502, 503])('retries a transient %i and then succeeds', async (status) => {
      const fetch = mockFetch(textResponse('busy', status), jsonResponse({ ok: true }));

      const result = fetchJson(URL_, { body: {} });
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([400, 401, 403, 404, 422])(
      'does not retry a client error %i (retrying cannot fix it)',
      async (status) => {
        const fetch = mockFetch(textResponse('nope', status));

        await expect(fetchJson(URL_, { body: {} })).rejects.toMatchObject({
          status: 502,
          code: 'UPSTREAM_ERROR',
          message: `Upstream responded ${status}`,
        });
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );

    it('backs off exponentially between attempts (300ms, then 600ms)', async () => {
      const fetch = mockFetch(
        textResponse('', 503),
        textResponse('', 503),
        jsonResponse({ ok: true }),
      );

      const result = fetchJson(URL_, { body: {}, retries: 2 });

      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(299);
      expect(fetch).toHaveBeenCalledTimes(1); // still waiting
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(599);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(3);

      await expect(result).resolves.toEqual({ ok: true });
    });

    it('gives up after `retries` extra attempts and surfaces the last upstream error', async () => {
      const fetch = mockFetch(
        textResponse('first', 500),
        textResponse('second', 500),
        textResponse('third: overloaded', 503),
      );

      const result = fetchJson(URL_, { body: {}, retries: 2 });
      const assertion = expect(result).rejects.toMatchObject({
        status: 502,
        message: 'Upstream responded 503',
        details: 'third: overloaded',
      });
      await vi.runAllTimersAsync();
      await assertion;

      expect(fetch).toHaveBeenCalledTimes(3);
    });

    it('makes exactly one attempt when retries = 0', async () => {
      const fetch = mockFetch(textResponse('', 500));

      await expect(fetchJson(URL_, { body: {}, retries: 0 })).rejects.toBeInstanceOf(AppError);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('recovers from a network error (e.g. connection reset)', async () => {
      const fetch = mockFetch(new TypeError('fetch failed'), jsonResponse({ ok: true }));

      const result = fetchJson(URL_, { body: {} });
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('error shape', () => {
    it('wraps raw network failures in an AppError so the API returns 502, not 500', async () => {
      mockFetch(new TypeError('fetch failed'));

      const err = await fetchJson(URL_, { body: {}, retries: 0 }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect(err).toMatchObject({
        status: 502,
        code: 'UPSTREAM_ERROR',
        message: 'Upstream request failed',
        details: 'TypeError: fetch failed',
      });
    });

    it('reports timeouts as upstream errors', async () => {
      mockFetch(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

      const err = await fetchJson(URL_, { body: {}, retries: 0 }).catch((e: unknown) => e);

      expect(err).toMatchObject({ status: 502, details: expect.stringMatching(/TimeoutError/) });
    });

    it('caps the echoed upstream body at 500 chars (no giant HTML error pages in logs)', async () => {
      mockFetch(textResponse('x'.repeat(10_000), 400));

      const err = (await fetchJson(URL_, { body: {} }).catch((e: unknown) => e)) as AppError;

      expect((err.details as string).length).toBe(500);
    });
  });
});

describe('streamLines', () => {
  it('splits a body into trimmed, non-empty lines', async () => {
    const res = streamResponse(['alpha\n\n  beta  \r\ngamma\n']);

    expect(await collect(streamLines(res))).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('reassembles lines that are split across network chunks', async () => {
    const res = streamResponse(['data: {"te', 'xt":"hel', 'lo"}\nda', 'ta: [DONE]\n']);

    expect(await collect(streamLines(res))).toEqual(['data: {"text":"hello"}', 'data: [DONE]']);
  });

  it('flushes a final line that has no trailing newline', async () => {
    const res = streamResponse(['first\nlast-without-newline']);

    expect(await collect(streamLines(res))).toEqual(['first', 'last-without-newline']);
  });

  it('does not corrupt multi-byte UTF-8 characters split across chunks', async () => {
    // "नमस्ते 👋" — split the encoded bytes in the middle of a character.
    const bytes = new TextEncoder().encode('नमस्ते 👋\n');
    const res = streamResponse([bytes.slice(0, 4), bytes.slice(4, 13), bytes.slice(13)]);

    expect(await collect(streamLines(res))).toEqual(['नमस्ते 👋']);
  });

  it('yields nothing for an empty body', async () => {
    expect(await collect(streamLines(new Response(null)))).toEqual([]);
    expect(await collect(streamLines(streamResponse([])))).toEqual([]);
  });
});
