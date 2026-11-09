import { useRef, useState, type DragEvent } from 'react';
import type { DocumentMeta, ServerStatus } from '../lib/types';

interface Props {
  documents: DocumentMeta[];
  selected: Set<string>;
  status: ServerStatus | null;
  uploading: boolean;
  onToggle: (id: string) => void;
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => void;
}

const ACCEPT = '.pdf,.md,.markdown,.txt,.json,.csv';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function Sidebar({
  documents,
  selected,
  status,
  uploading,
  onToggle,
  onUpload,
  onDelete,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onUpload([...e.dataTransfer.files]);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">◆</span> DocuMind
      </div>

      <button
        type="button"
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        disabled={uploading}
      >
        {uploading ? 'Indexing…' : 'Drop files or click to upload'}
        <small>PDF · Markdown · TXT · JSON · CSV</small>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          onUpload([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      <div className="section-title">
        Knowledge base <span className="count">{documents.length}</span>
      </div>
      {selected.size > 0 && <div className="hint">Searching {selected.size} selected</div>}

      <ul className="doc-list">
        {documents.length === 0 && <li className="empty">No documents yet.</li>}
        {documents.map((doc) => (
          <li key={doc.id} className={selected.has(doc.id) ? 'active' : ''}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(doc.id)}
                onChange={() => onToggle(doc.id)}
              />
              <span className="doc-name" title={doc.name}>
                {doc.name}
              </span>
            </label>
            <span className="doc-meta">
              {doc.chunkCount} {doc.chunkCount === 1 ? 'chunk' : 'chunks'} ·{' '}
              {formatBytes(doc.sizeBytes)}
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete ${doc.name}`}
              onClick={() => onDelete(doc.id)}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <footer className="status">
        <span className={`dot ${status ? 'ok' : 'down'}`} />
        {status ? (
          <span>
            {status.llm} · {status.embeddings}
          </span>
        ) : (
          <span>API offline</span>
        )}
      </footer>
    </aside>
  );
}
