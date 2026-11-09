import { vi, type Mock } from 'vitest';

/**
 * Test doubles for the network boundary.
 *
 * We build real `Response` objects (not hand-rolled fakes) so the code under test
 * exercises the same body/stream APIs it uses against a live server.
 */

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

/**
 * A streaming response that delivers `chunks` exactly as given, so tests can
 * control where network packet boundaries fall (mid-line, mid-character, ...).
 */
export function streamResponse(chunks: Array<string | Uint8Array>, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

/** Replaces global fetch with a mock that returns the given responses in order. */
export function mockFetch(...responses: Array<Response | Error>): Mock {
  const fn = vi.fn();
  for (const r of responses) {
    if (r instanceof Error) fn.mockRejectedValueOnce(r);
    else fn.mockResolvedValueOnce(r);
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Parses the JSON body that was sent on the n-th fetch call. */
export function sentBody(fetchMock: Mock, call = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

export function sentHeaders(fetchMock: Mock, call = 0): Record<string, string> {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}
