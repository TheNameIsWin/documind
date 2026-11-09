export interface DocumentMeta {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: string;
}

export interface Chunk {
  id: string;
  documentId: string;
  documentName: string;
  index: number;
  text: string;
  /** Character offsets into the normalized source text — enables precise citations. */
  start: number;
  end: number;
}

export interface StoredChunk extends Chunk {
  embedding: number[];
}

export interface ScoredChunk extends Chunk {
  score: number;
}

export interface Citation {
  ref: number;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
