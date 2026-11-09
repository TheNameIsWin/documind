import { SseParser } from './sse';
import type { Citation, DocumentMeta, ServerStatus, Usage } from './types';

const BASE = import.meta.env.VITE_API_URL ?? '';

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return res.status === 204 ? (undefined as T) : res.json();
  const body = await res.json().catch(() => null);
  throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
}

export const api = {
  status: () => fetch(`${BASE}/ready`).then((r) => handle<ServerStatus>(r)),

  listDocuments: () =>
    fetch(`${BASE}/api/documents`)
      .then((r) => handle<{ documents: DocumentMeta[] }>(r))
      .then((r) => r.documents),

  upload: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return fetch(`${BASE}/api/documents`, { method: 'POST', body: form })
      .then((r) => handle<{ document: DocumentMeta }>(r))
      .then((r) => r.document);
  },

  deleteDocument: (id: string) =>
    fetch(`${BASE}/api/documents/${id}`, { method: 'DELETE' }).then((r) => handle<void>(r)),
};

export interface ChatHandlers {
  onCitations: (citations: Citation[]) => void;
  onToken: (text: string) => void;
  onDone: (usage: Usage) => void;
}

export async function streamChat(
  body: {
    question: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    documentIds?: string[];
  },
  handlers: ChatHandlers,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) await handle(res);

  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const { event, data } of parser.push(value)) {
      const payload = JSON.parse(data);
      if (event === 'citations') handlers.onCitations(payload.citations);
      else if (event === 'token') handlers.onToken(payload.text);
      else if (event === 'done') handlers.onDone(payload.usage);
      else if (event === 'error') throw new Error(payload.message);
    }
  }
}
