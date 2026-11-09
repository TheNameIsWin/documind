export interface DocumentMeta {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  createdAt: string;
}

export interface Citation {
  ref: number;
  documentId: string;
  documentName: string;
  chunkIndex: number;
  score: number;
  snippet: string;
}

export interface Usage {
  retrievalMs: number;
  generationMs: number;
  model: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  usage?: Usage;
  pending?: boolean;
  error?: string;
}

export interface ServerStatus {
  embeddings: string;
  llm: string;
  documents: number;
}
