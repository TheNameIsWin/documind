import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalHashEmbeddings } from '../src/core/embeddings/local.js';
import { IngestionService } from '../src/core/ingestion/ingestion-service.js';
import { Bm25Index } from '../src/core/rag/bm25.js';
import { HybridRetriever, mmr } from '../src/core/rag/retriever.js';
import { MemoryVectorStore } from '../src/core/vectorstore/memory-store.js';
import { HANDBOOK, RECIPES } from './fixtures.js';

async function setup() {
  const embeddings = new LocalHashEmbeddings();
  const store = new MemoryVectorStore(embeddings.name);
  const ingestion = new IngestionService(store, embeddings, { chunkSize: 300, overlap: 50 });
  const handbook = await ingestion.ingestText('handbook.md', HANDBOOK);
  const recipes = await ingestion.ingestText('recipes.md', RECIPES);
  return {
    store,
    embeddings,
    ingestion,
    handbook,
    recipes,
    retriever: new HybridRetriever(store, embeddings),
  };
}

describe('IngestionService', () => {
  it('chunks, embeds and stores a document', async () => {
    const { store, handbook } = await setup();
    expect(handbook.chunkCount).toBeGreaterThan(1);
    expect(store.getChunks(handbook.id)).toHaveLength(handbook.chunkCount);
    expect(store.listDocuments()).toHaveLength(2);
  });

  it('is idempotent for identical content', async () => {
    const { store, ingestion } = await setup();
    await ingestion.ingestText('handbook.md', HANDBOOK);
    expect(store.listDocuments()).toHaveLength(2);
  });
});

describe('HybridRetriever', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    ctx = await setup();
  });

  it('finds the passage that answers the question', async () => {
    const results = await ctx.retriever.retrieve('When does the on-call rotation start?', {
      topK: 3,
      minScore: 0,
    });
    expect(results[0]?.text).toContain('Monday at 10:00 IST');
  });

  it('matches exact identifiers via BM25', async () => {
    const results = await ctx.retriever.retrieve('ERR_5001', { topK: 2, minScore: 0.9 });
    expect(results.some((r) => r.text.includes('ERR_5001'))).toBe(true);
  });

  it('restricts results to the requested documents', async () => {
    const results = await ctx.retriever.retrieve('ginger', {
      topK: 5,
      minScore: 0,
      documentIds: [ctx.handbook.id],
    });
    expect(results.every((r) => r.documentId === ctx.handbook.id)).toBe(true);
  });

  it('returns nothing when the corpus is empty', async () => {
    const empty = new MemoryVectorStore('x');
    const retriever = new HybridRetriever(empty, ctx.embeddings);
    expect(await retriever.retrieve('anything', { topK: 3, minScore: 0 })).toEqual([]);
  });

  it('reindexes keywords after documents change', async () => {
    await ctx.retriever.retrieve('chai', { topK: 1, minScore: 0 });
    await ctx.store.deleteDocument(ctx.recipes.id);
    const results = await ctx.retriever.retrieve('chai cardamom', { topK: 5, minScore: 0 });
    expect(results.every((r) => r.documentId !== ctx.recipes.id)).toBe(true);
  });
});

describe('Bm25Index', () => {
  it('ranks documents containing rare terms higher', () => {
    const index = new Bm25Index();
    const mk = (id: string, text: string) => ({
      id,
      text,
      documentId: 'd',
      documentName: 'd',
      index: 0,
      start: 0,
      end: text.length,
    });
    index.build([
      mk('a', 'kubernetes cluster upgrade'),
      mk('b', 'cluster cluster cluster'),
      mk('c', 'coffee'),
    ]);
    expect(index.search('kubernetes cluster', 3)[0]?.chunk.id).toBe('a');
    expect(index.search('', 3)).toEqual([]);
  });
});

describe('mmr', () => {
  it('prefers diverse results over near-duplicates', () => {
    const base = {
      documentId: 'd',
      documentName: 'd',
      index: 0,
      start: 0,
      end: 1,
      text: '',
      score: 1,
    };
    const picked = mmr(
      [
        { chunk: { ...base, id: 'a' }, relevance: 1.0, vector: [1, 0] },
        { chunk: { ...base, id: 'a-dup' }, relevance: 0.99, vector: [1, 0] },
        { chunk: { ...base, id: 'b' }, relevance: 0.8, vector: [0, 1] },
      ],
      2,
      0.5,
    );
    expect(picked.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('MemoryVectorStore persistence', () => {
  it('survives a restart and refuses vectors from another model', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'documind-'));
    const file = path.join(dir, 'index.json');
    try {
      const embeddings = new LocalHashEmbeddings();
      const store = new MemoryVectorStore(embeddings.name, file);
      await new IngestionService(store, embeddings, { chunkSize: 300, overlap: 0 }).ingestText(
        'h',
        HANDBOOK,
      );

      const reloaded = new MemoryVectorStore(embeddings.name, file);
      await reloaded.load();
      expect(reloaded.listDocuments()).toHaveLength(1);
      expect(reloaded.allChunks().length).toBe(store.allChunks().length);

      const otherModel = new MemoryVectorStore('other-model', file);
      await otherModel.load();
      expect(otherModel.listDocuments()).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
