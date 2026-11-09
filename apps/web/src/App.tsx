import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { MessageView } from './components/MessageView';
import { Sidebar } from './components/Sidebar';
import { api } from './lib/api';
import type { DocumentMeta, ServerStatus } from './lib/types';
import { useChat } from './lib/useChat';

const SUGGESTIONS = [
  'Summarize the key points of my documents',
  'What are the most important dates or deadlines?',
  'List any numbers, limits or thresholds mentioned',
];

export default function App() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [input, setInput] = useState('');

  const { messages, busy, send, stop, reset } = useChat([...selected]);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [docs, s] = await Promise.all([api.listDocuments(), api.status()]);
      setDocuments(docs);
      setStatus(s);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const onUpload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const results = await Promise.allSettled(files.map((f) => api.upload(f)));
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed.length) setToast(failed[0]!.reason.message);
      else setToast(`Indexed ${files.length} file${files.length > 1 ? 's' : ''}`);
      await refresh();
    } finally {
      setUploading(false);
    }
  };

  const onDelete = async (id: string) => {
    await api.deleteDocument(id);
    setSelected((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
    refresh();
  };

  const onToggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setInput('');
    send(question);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="layout">
      <Sidebar
        documents={documents}
        selected={selected}
        status={status}
        uploading={uploading}
        onToggle={onToggle}
        onUpload={onUpload}
        onDelete={onDelete}
      />

      <main className="chat">
        <header className="chat-header">
          <h1>Ask your documents</h1>
          {messages.length > 0 && (
            <button type="button" className="ghost" onClick={reset}>
              New chat
            </button>
          )}
        </header>

        <section className="messages">
          {messages.length === 0 ? (
            <div className="welcome">
              <h2>Grounded answers, with receipts.</h2>
              <p>
                Upload documents on the left, then ask anything. Every answer cites the exact
                passages it came from.
              </p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => send(s)}
                    disabled={!documents.length}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => <MessageView key={m.id} message={m} />)
          )}
          <div ref={endRef} />
        </section>

        <form className="composer" onSubmit={submit}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={documents.length ? 'Ask a question…' : 'Upload a document to get started'}
            rows={1}
            maxLength={2000}
          />
          {busy ? (
            <button type="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
