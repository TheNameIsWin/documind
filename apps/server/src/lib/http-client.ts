import { AppError } from './errors.js';

export interface FetchJsonOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryable(status: number) {
  return status === 429 || status >= 500;
}

/**
 * JSON fetch with timeout and exponential backoff (with jitter) for transient failures.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { method = 'POST', headers = {}, body, timeoutMs = 30_000, retries = 2 } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) return (await res.json()) as T;

      const text = await res.text().catch(() => '');
      lastError = AppError.upstream(`Upstream responded ${res.status}`, text.slice(0, 500));
      if (!isRetryable(res.status)) break;
    } catch (err) {
      lastError = err;
    }

    if (attempt < retries) {
      await sleep(2 ** attempt * 300 + Math.random() * 200);
    }
  }

  if (lastError instanceof AppError) throw lastError;
  throw AppError.upstream('Upstream request failed', String(lastError));
}

/**
 * Streams a fetch response body line by line (works for both SSE and NDJSON).
 */
export async function* streamLines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield line;
    }
  }
  const rest = buffer.trim();
  if (rest) yield rest;
}
