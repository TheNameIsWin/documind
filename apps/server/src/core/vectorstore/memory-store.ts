import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import type { DocumentMeta, ScoredChunk, StoredChunk } from '../types.js';
import { dot } from './math.js';
import type { VectorStore } from './store.js';

interface Snapshot {
  schema: 1;
  embeddingModel: string;
  documents: DocumentMeta[];
  chunks: StoredChunk[];
}

/**
 * In-process vector store with exact (brute-force) cosine search and optional
 * crash-safe JSON persistence. Exact search is O(n·d) and comfortably handles tens of
 * thousands of chunks; the `VectorStore` interface lets you swap in pgvector, Qdrant
 * or similar without touching the RAG pipeline.
 */
export class MemoryVectorStore implements VectorStore {
  private documents = new Map<string, DocumentMeta>();
  private chunksByDoc = new Map<string, StoredChunk[]>();
  private writeQueue: Promise<void> = Promise.resolve();
  private _version = 0;

  constructor(
    private readonly embeddingModel: string,
    private readonly filePath?: string,
    private readonly logger?: Logger,
  ) {}

  get version() {
    return this._version;
  }

  async load(): Promise<void> {
    if (!this.filePath) return;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch {
      return; // first run
    }

    const snapshot = JSON.parse(raw) as Snapshot;
    if (snapshot.embeddingModel !== this.embeddingModel) {
      // Vectors from different models live in different spaces; mixing them is silent garbage.
      this.logger?.warn(
        { stored: snapshot.embeddingModel, current: this.embeddingModel },
        'Embedding model changed — ignoring persisted index. Re-upload documents to re-index.',
      );
      return;
    }

    for (const doc of snapshot.documents) this.documents.set(doc.id, doc);
    for (const chunk of snapshot.chunks) {
      const list = this.chunksByDoc.get(chunk.documentId) ?? [];
      list.push(chunk);
      this.chunksByDoc.set(chunk.documentId, list);
    }
    this._version++;
    this.logger?.info({ documents: this.documents.size }, 'Loaded persisted index');
  }

  async addDocument(meta: DocumentMeta, chunks: StoredChunk[]): Promise<void> {
    this.documents.set(meta.id, meta);
    this.chunksByDoc.set(meta.id, chunks);
    this._version++;
    await this.persist();
  }

  async deleteDocument(id: string): Promise<boolean> {
    const existed = this.documents.delete(id);
    this.chunksByDoc.delete(id);
    if (existed) {
      this._version++;
      await this.persist();
    }
    return existed;
  }

  getDocument(id: string) {
    return this.documents.get(id);
  }

  listDocuments() {
    return [...this.documents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getChunks(documentId: string) {
    return this.chunksByDoc.get(documentId) ?? [];
  }

  allChunks() {
    return [...this.chunksByDoc.values()].flat();
  }

  search(query: number[], k: number, documentIds?: string[]): ScoredChunk[] {
    const pool = documentIds?.length
      ? documentIds.flatMap((id) => this.getChunks(id))
      : this.allChunks();

    // Bounded top-k selection keeps memory flat regardless of corpus size.
    const top: ScoredChunk[] = [];
    for (const chunk of pool) {
      const score = dot(query, chunk.embedding);
      if (top.length < k || score > (top[top.length - 1] as ScoredChunk).score) {
        const { embedding: _embedding, ...rest } = chunk;
        top.push({ ...rest, score });
        top.sort((a, b) => b.score - a.score);
        if (top.length > k) top.pop();
      }
    }
    return top;
  }

  /** Serialized, atomic writes: temp file + rename, so a crash never corrupts the index. */
  private persist(): Promise<void> {
    if (!this.filePath) return Promise.resolve();
    const filePath = this.filePath;

    this.writeQueue = this.writeQueue.then(async () => {
      const snapshot: Snapshot = {
        schema: 1,
        embeddingModel: this.embeddingModel,
        documents: [...this.documents.values()],
        chunks: this.allChunks(),
      };
      await mkdir(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot));
      await rename(tmp, filePath);
    });
    return this.writeQueue;
  }
}
