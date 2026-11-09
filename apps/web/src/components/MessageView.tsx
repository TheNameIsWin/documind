import { Fragment, useState } from 'react';
import type { Citation, Message } from '../lib/types';

/** Renders "[1]" markers in the answer as interactive citation chips. */
function AnswerText({ text, citations }: { text: string; citations: Citation[] }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="answer">
      {parts.map((part, i) => {
        const match = /^\[(\d+)\]$/.exec(part);
        const citation = match && citations.find((c) => c.ref === Number(match[1]));
        if (!citation) return <Fragment key={i}>{part}</Fragment>;
        return (
          <sup key={i} className="cite" title={`${citation.documentName}\n\n${citation.snippet}`}>
            {citation.ref}
          </sup>
        );
      })}
    </p>
  );
}

function Sources({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!citations.length) return null;
  return (
    <div className="sources">
      {citations.map((c) => (
        <button
          type="button"
          key={c.ref}
          className={`source ${open === c.ref ? 'open' : ''}`}
          onClick={() => setOpen(open === c.ref ? null : c.ref)}
        >
          <span className="source-ref">{c.ref}</span>
          <span className="source-name">{c.documentName}</span>
          <span className="source-score">{Math.round(c.score * 100)}%</span>
          {open === c.ref && <span className="source-snippet">{c.snippet}</span>}
        </button>
      ))}
    </div>
  );
}

export function MessageView({ message }: { message: Message }) {
  if (message.role === 'user') {
    return <div className="msg user">{message.content}</div>;
  }

  return (
    <div className="msg assistant">
      {message.error ? (
        <p className="error">⚠ {message.error}</p>
      ) : message.content ? (
        <AnswerText text={message.content} citations={message.citations ?? []} />
      ) : (
        <div className="typing" aria-label="Thinking">
          <span />
          <span />
          <span />
        </div>
      )}
      {!message.pending && <Sources citations={message.citations ?? []} />}
      {message.usage && (
        <div className="usage">
          {message.usage.model} · retrieval {message.usage.retrievalMs} ms · generation{' '}
          {message.usage.generationMs} ms
        </div>
      )}
    </div>
  );
}
