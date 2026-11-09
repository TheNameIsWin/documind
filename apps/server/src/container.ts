import path from 'node:path';
import type { Env } from './config/env.js';
import { LocalHashEmbeddings } from './core/embeddings/local.js';
import type { EmbeddingProvider } from './core/embeddings/provider.js';
import { OllamaEmbeddings, OpenAIEmbeddings } from './core/embeddings/remote.js';
import { IngestionService } from './core/ingestion/ingestion-service.js';
import { ExtractiveAnswerer } from './core/llm/extractive.js';
import { OllamaChat } from './core/llm/ollama.js';
import { OpenAIChat } from './core/llm/openai.js';
import type { LlmProvider } from './core/llm/provider.js';
import { RagService } from './core/rag/rag-service.js';
import { HybridRetriever } from './core/rag/retriever.js';
import { MemoryVectorStore } from './core/vectorstore/memory-store.js';
import type { Logger } from './lib/logger.js';

export interface Container {
  env: Env;
  logger: Logger;
  store: MemoryVectorStore;
  embeddings: EmbeddingProvider;
  llm: LlmProvider;
  ingestion: IngestionService;
  rag: RagService;
}

function createEmbeddings(env: Env): EmbeddingProvider {
  switch (env.EMBEDDINGS_PROVIDER) {
    case 'openai':
      return new OpenAIEmbeddings({
        apiKey: env.OPENAI_API_KEY as string,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.OPENAI_EMBED_MODEL,
      });
    case 'ollama':
      return new OllamaEmbeddings({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_EMBED_MODEL });
    default:
      return new LocalHashEmbeddings();
  }
}

function createLlm(env: Env): LlmProvider {
  switch (env.LLM_PROVIDER) {
    case 'openai':
      return new OpenAIChat({
        apiKey: env.OPENAI_API_KEY as string,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.OPENAI_CHAT_MODEL,
      });
    case 'ollama':
      return new OllamaChat({ baseUrl: env.OLLAMA_BASE_URL, model: env.OLLAMA_CHAT_MODEL });
    default:
      return new ExtractiveAnswerer();
  }
}

/** Composition root: the only place that knows concrete implementations. */
export async function createContainer(
  env: Env,
  logger: Logger,
  overrides: Partial<Pick<Container, 'embeddings' | 'llm'>> & { persist?: boolean } = {},
): Promise<Container> {
  const embeddings = overrides.embeddings ?? createEmbeddings(env);
  const llm = overrides.llm ?? createLlm(env);

  const persist = overrides.persist ?? env.NODE_ENV !== 'test';
  const store = new MemoryVectorStore(
    embeddings.name,
    persist ? path.resolve(env.DATA_DIR, 'index.json') : undefined,
    logger,
  );
  await store.load();

  const ingestion = new IngestionService(store, embeddings, {
    chunkSize: env.CHUNK_SIZE,
    overlap: env.CHUNK_OVERLAP,
  });
  const retriever = new HybridRetriever(store, embeddings);
  const rag = new RagService(retriever, llm, { topK: env.TOP_K, minScore: env.MIN_SCORE });

  return { env, logger, store, embeddings, llm, ingestion, rag };
}
