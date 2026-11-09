import { useCallback, useRef, useState } from 'react';
import { streamChat } from './api';
import type { Message } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

export function useChat(documentIds: string[]) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const patch = (id: string, fn: (m: Message) => Message) =>
    setMessages((all) => all.map((m) => (m.id === id ? fn(m) : m)));

  const send = useCallback(
    async (question: string) => {
      const history = messages
        .filter((m) => !m.error && !m.pending)
        .map(({ role, content }) => ({ role, content }));

      const assistantId = uid();
      setMessages((all) => [
        ...all,
        { id: uid(), role: 'user', content: question },
        { id: assistantId, role: 'assistant', content: '', pending: true },
      ]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          { question, history, documentIds: documentIds.length ? documentIds : undefined },
          {
            onCitations: (citations) => patch(assistantId, (m) => ({ ...m, citations })),
            onToken: (text) => patch(assistantId, (m) => ({ ...m, content: m.content + text })),
            onDone: (usage) => patch(assistantId, (m) => ({ ...m, usage, pending: false })),
          },
          controller.signal,
        );
      } catch (err) {
        if (controller.signal.aborted) {
          patch(assistantId, (m) => ({ ...m, pending: false }));
        } else {
          const error = err instanceof Error ? err.message : 'Something went wrong';
          patch(assistantId, (m) => ({ ...m, pending: false, error }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [messages, documentIds],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
  }, []);

  return { messages, busy, send, stop, reset };
}
