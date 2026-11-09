import { stem, tokenize } from '../embeddings/local.js';
import { splitSentences } from '../llm/extractive.js';
import type { LlmProvider } from '../llm/provider.js';
import type { ChatMessage, Citation, ScoredChunk } from '../types.js';
import { buildMessages } from './prompt.js';
import type { HybridRetriever } from './retriever.js';

export interface AskInput {
  question: string;
  history?: ChatMessage[];
  documentIds?: string[];
  topK?: number;
  signal?: AbortSignal;
}

export type AnswerEvent =
  | { type: 'citations'; citations: Citation[] }
  | { type: 'token'; text: string }
  | {
      type: 'done';
      answer: string;
      usage: { retrievalMs: number; generationMs: number; model: string };
    };

const NO_CONTEXT_ANSWER =
  "I couldn't find anything relevant in your documents. Try rephrasing, or upload a document that covers this topic.";

export class RagService {
  constructor(
    private readonly retriever: HybridRetriever,
    private readonly llm: LlmProvider,
    private readonly defaults: { topK: number; minScore: number },
  ) {}

  /** Streams the answer as typed events: citations first, then tokens, then a summary. */
  async *ask(input: AskInput): AsyncGenerator<AnswerEvent> {
    const t0 = performance.now();
    const context = await this.retriever.retrieve(input.question, {
      topK: input.topK ?? this.defaults.topK,
      minScore: this.defaults.minScore,
      documentIds: input.documentIds,
    });
    const retrievalMs = Math.round(performance.now() - t0);

    yield { type: 'citations', citations: toCitations(context, input.question) };

    const t1 = performance.now();
    let answer = '';

    if (!context.length) {
      answer = NO_CONTEXT_ANSWER;
      yield { type: 'token', text: answer };
    } else {
      const messages = buildMessages(input.question, context, input.history);
      for await (const text of this.llm.stream({
        messages,
        context,
        question: input.question,
        signal: input.signal,
      })) {
        answer += text;
        yield { type: 'token', text };
      }
    }

    yield {
      type: 'done',
      answer,
      usage: {
        retrievalMs,
        generationMs: Math.round(performance.now() - t1),
        model: this.llm.name,
      },
    };
  }

  /** Convenience non-streaming variant. */
  async answer(input: AskInput) {
    let citations: Citation[] = [];
    for await (const event of this.ask(input)) {
      if (event.type === 'citations') citations = event.citations;
      if (event.type === 'done') return { answer: event.answer, citations, usage: event.usage };
    }
    throw new Error('Answer stream ended unexpectedly');
  }
}

function toCitations(chunks: ScoredChunk[], question: string): Citation[] {
  return chunks.map((c, i) => ({
    ref: i + 1,
    documentId: c.documentId,
    documentName: c.documentName,
    chunkIndex: c.index,
    score: Number(c.score.toFixed(4)),
    snippet: bestSnippet(c.text, question),
  }));
}

/**
 * Picks the window of the chunk that best matches the question, so the citation
 * preview shows *why* the passage was retrieved rather than its first 280 characters.
 */
export function bestSnippet(text: string, question: string, maxLength = 280): string {
  const terms = new Set(tokenize(question).map(stem));
  const sentences = splitSentences(text);
  if (!sentences.length) return truncate(text, maxLength);

  let bestIndex = 0;
  let bestScore = -1;
  sentences.forEach((sentence, i) => {
    const score = tokenize(sentence)
      .map(stem)
      .filter((t) => terms.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });

  // Grow the window forward from the best sentence while it fits.
  let snippet = sentences[bestIndex] as string;
  for (let i = bestIndex + 1; i < sentences.length; i++) {
    const next = `${snippet} ${sentences[i]}`;
    if (next.length > maxLength) break;
    snippet = next;
  }
  return truncate(snippet, maxLength);
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
