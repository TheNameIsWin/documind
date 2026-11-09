import type { DocumentMeta, ScoredChunk, StoredChunk } from '../types.js';

export interface VectorStore {
  addDocument(meta: DocumentMeta, chunks: StoredChunk[]): Promise<void>;
  deleteDocument(id: string): Promise<boolean>;
  getDocument(id: string): DocumentMeta | undefined;
  listDocuments(): DocumentMeta[];
  getChunks(documentId: string): StoredChunk[];
  allChunks(): StoredChunk[];
  search(query: number[], k: number, documentIds?: string[]): ScoredChunk[];
  /** Monotonic counter bumped on every mutation — lets derived indexes cache safely. */
  readonly version: number;
}
