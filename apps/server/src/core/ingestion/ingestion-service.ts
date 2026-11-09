import { createHash } from 'node:crypto';
import { AppError } from '../../lib/errors.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import type { DocumentMeta, StoredChunk } from '../types.js';
import type { VectorStore } from '../vectorstore/store.js';
import { chunkText, type ChunkerOptions } from './chunker.js';
import { parseDocument } from './parsers.js';

export interface IngestInput {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export class IngestionService {
  constructor(
    private readonly store: VectorStore,
    private readonly embeddings: EmbeddingProvider,
    private readonly chunking: ChunkerOptions,
  ) {}

  async ingest({ filename, mimeType, buffer }: IngestInput): Promise<DocumentMeta> {
    const text = await parseDocument(filename, buffer);
    if (!text) throw AppError.badRequest('Document contains no extractable text');

    const spans = chunkText(text, this.chunking);
    const vectors = await this.embeddings.embed(spans.map((s) => s.text));

    // Content-addressed id: re-uploading the same file replaces it instead of duplicating.
    const id = createHash('sha256').update(buffer).digest('hex').slice(0, 16);

    const chunks: StoredChunk[] = spans.map((span, index) => ({
      id: `${id}:${index}`,
      documentId: id,
      documentName: filename,
      index,
      text: span.text,
      start: span.start,
      end: span.end,
      embedding: vectors[index] ?? [],
    }));

    const meta: DocumentMeta = {
      id,
      name: filename,
      mimeType,
      sizeBytes: buffer.length,
      chunkCount: chunks.length,
      createdAt: new Date().toISOString(),
    };

    await this.store.addDocument(meta, chunks);
    return meta;
  }

  async ingestText(name: string, text: string): Promise<DocumentMeta> {
    const filename = /\.[a-z]+$/i.test(name) ? name : `${name}.txt`;
    return this.ingest({ filename, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
  }
}
