import { stem, tokenize } from '../embeddings/local.js';
import type { Chunk } from '../types.js';

interface IndexedDoc {
  chunk: Chunk;
  termFreq: Map<string, number>;
  length: number;
}

/**
 * Okapi BM25 keyword index. Dense embeddings miss exact identifiers (error codes, names,
 * version numbers); BM25 catches them. The two are fused in the retriever.
 */
export class Bm25Index {
  private docs: IndexedDoc[] = [];
  private docFreq = new Map<string, number>();
  private avgLength = 0;

  constructor(
    private readonly k1 = 1.2,
    private readonly b = 0.75,
  ) {}

  build(chunks: Chunk[]): void {
    this.docs = [];
    this.docFreq.clear();
    let totalLength = 0;

    for (const chunk of chunks) {
      const terms = tokenize(chunk.text).map(stem);
      const termFreq = new Map<string, number>();
      for (const term of terms) termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
      for (const term of termFreq.keys()) this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      this.docs.push({ chunk, termFreq, length: terms.length });
      totalLength += terms.length;
    }
    this.avgLength = this.docs.length ? totalLength / this.docs.length : 0;
  }

  search(query: string, k: number, documentIds?: string[]): { chunk: Chunk; score: number }[] {
    const terms = [...new Set(tokenize(query).map(stem))];
    if (!terms.length || !this.docs.length) return [];

    const filter = documentIds?.length ? new Set(documentIds) : undefined;
    const n = this.docs.length;
    const results: { chunk: Chunk; score: number }[] = [];

    for (const doc of this.docs) {
      if (filter && !filter.has(doc.chunk.documentId)) continue;
      let score = 0;
      for (const term of terms) {
        const tf = doc.termFreq.get(term);
        if (!tf) continue;
        const df = this.docFreq.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const norm = tf + this.k1 * (1 - this.b + (this.b * doc.length) / (this.avgLength || 1));
        score += idf * ((tf * (this.k1 + 1)) / norm);
      }
      if (score > 0) results.push({ chunk: doc.chunk, score });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, k);
  }
}
