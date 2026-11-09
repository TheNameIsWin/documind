import { stem, tokenize } from '../embeddings/local.js';
import type { GenerateInput, LlmProvider } from './provider.js';

interface Candidate {
  sentence: string;
  ref: number;
  score: number;
  order: number;
}

/**
 * Offline answer strategy: no model, no network. Selects the sentences from the
 * retrieved context that best cover the question terms and returns them with inline
 * citations. Useful for demos, CI, air-gapped environments and as a graceful fallback.
 */
export class ExtractiveAnswerer implements LlmProvider {
  readonly name = 'extractive';

  constructor(
    private readonly maxSentences = 3,
    private readonly relativeCutoff = 0.5,
  ) {}

  async *stream({ context, question }: GenerateInput): AsyncGenerator<string> {
    const queryTerms = new Set(tokenize(question).map(stem));
    const candidates: Candidate[] = [];
    let order = 0;

    context.forEach((chunk, i) => {
      for (const sentence of splitSentences(chunk.text)) {
        const terms = new Set(tokenize(sentence).map(stem));
        let overlap = 0;
        for (const t of queryTerms) if (terms.has(t)) overlap++;
        if (!overlap) continue;
        // Coverage of the question, lightly weighted by retrieval rank and penalized for length.
        const coverage = overlap / Math.max(queryTerms.size, 1);
        const score = coverage * (1 + chunk.score) - Math.min(sentence.length / 2000, 0.2);
        candidates.push({ sentence, ref: i + 1, score, order: order++ });
      }
    });

    if (!candidates.length) {
      yield "I couldn't find anything in your documents that answers that.";
      return;
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = (candidates[0] as Candidate).score;
    const picked = candidates
      // Only keep sentences that are competitive with the best match.
      .filter((c) => c.score >= best * this.relativeCutoff)
      .slice(0, this.maxSentences)
      .sort((a, b) => a.order - b.order);

    const answer = picked.map((c) => `${c.sentence.trim()} [${c.ref}]`).join(' ');
    // Stream word by word so the UI behaves identically to a real model.
    for (const word of answer.split(/(\s+)/)) yield word;
  }
}

/**
 * Splits text into sentences, treating line breaks as hard boundaries and dropping
 * Markdown headings so titles never get glued onto the first sentence of a section.
 */
export function splitSentences(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^#{1,6}\s/.test(line))
    .map((line) => line.replace(/^([-*+]|\d+\.)\s+/, ''))
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
}
