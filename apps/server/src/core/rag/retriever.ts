import type { EmbeddingProvider } from '../embeddings/provider.js';
import type { ScoredChunk, StoredChunk } from '../types.js';
import { dot } from '../vectorstore/math.js';
import type { VectorStore } from '../vectorstore/store.js';
import { Bm25Index } from './bm25.js';

export interface RetrieveOptions {
  topK: number;
  minScore: number;
  documentIds?: string[];
  /** 0 = pure diversity, 1 = pure relevance. */
  mmrLambda?: number;
}

const RRF_K = 60;

/**
 * Hybrid retriever:
 *   1. Dense vector search and BM25 keyword search each return a candidate pool.
 *   2. Reciprocal Rank Fusion merges the two rankings (robust to their different scales).
 *   3. Maximal Marginal Relevance re-ranks so the context window isn't five near-duplicates.
 */
export class HybridRetriever {
  private bm25 = new Bm25Index();
  private bm25Version = -1;

  constructor(
    private readonly store: VectorStore,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async retrieve(query: string, opts: RetrieveOptions): Promise<ScoredChunk[]> {
    const { topK, minScore, documentIds, mmrLambda = 0.7 } = opts;
    const poolSize = Math.max(topK * 4, 20);

    const [queryVector] = await this.embeddings.embed([query]);
    if (!queryVector) return [];

    const dense = this.store.search(queryVector, poolSize, documentIds);
    const sparse = this.keywordIndex().search(query, poolSize, documentIds);

    // --- Reciprocal Rank Fusion ---
    const fused = new Map<string, { id: string; rrf: number; keywordHit: boolean }>();
    dense.forEach((chunk, rank) => {
      fused.set(chunk.id, { id: chunk.id, rrf: 1 / (RRF_K + rank + 1), keywordHit: false });
    });
    sparse.forEach(({ chunk }, rank) => {
      const contribution = 1 / (RRF_K + rank + 1);
      const entry = fused.get(chunk.id);
      if (entry) {
        entry.rrf += contribution;
        entry.keywordHit = true;
      } else {
        fused.set(chunk.id, { id: chunk.id, rrf: contribution, keywordHit: true });
      }
    });

    const byId = new Map<string, StoredChunk>(this.store.allChunks().map((c) => [c.id, c]));
    const candidates: MmrCandidate[] = [];
    for (const { id, rrf, keywordHit } of fused.values()) {
      const stored = byId.get(id);
      if (!stored) continue;
      // Dense cosine is the user-facing relevance score.
      const score = dot(queryVector, stored.embedding);
      // Drop weak semantic matches unless they contain an exact keyword hit.
      if (score < minScore && !keywordHit) continue;
      const { embedding, ...chunk } = stored;
      candidates.push({ chunk: { ...chunk, score }, relevance: rrf, vector: embedding });
    }

    candidates.sort((a, b) => b.relevance - a.relevance);
    return mmr(candidates, topK, mmrLambda);
  }

  private keywordIndex(): Bm25Index {
    if (this.bm25Version !== this.store.version) {
      this.bm25.build(this.store.allChunks());
      this.bm25Version = this.store.version;
    }
    return this.bm25;
  }
}

interface MmrCandidate {
  chunk: ScoredChunk;
  relevance: number;
  vector: number[];
}

export function mmr(candidates: MmrCandidate[], k: number, lambda: number): ScoredChunk[] {
  if (!candidates.length) return [];
  const maxRel = Math.max(...candidates.map((c) => c.relevance)) || 1;
  const remaining = [...candidates];
  const selected: MmrCandidate[] = [];

  while (selected.length < k && remaining.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    remaining.forEach((cand, i) => {
      const redundancy = selected.length
        ? Math.max(...selected.map((s) => dot(cand.vector, s.vector)))
        : 0;
      const score = lambda * (cand.relevance / maxRel) - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    });
    selected.push(...remaining.splice(bestIndex, 1));
  }
  return selected.map((s) => s.chunk);
}
