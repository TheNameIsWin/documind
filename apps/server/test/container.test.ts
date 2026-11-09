import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { createContainer } from '../src/container.js';
import { LocalHashEmbeddings } from '../src/core/embeddings/local.js';
import { OllamaEmbeddings, OpenAIEmbeddings } from '../src/core/embeddings/remote.js';
import { ExtractiveAnswerer } from '../src/core/llm/extractive.js';
import { OllamaChat } from '../src/core/llm/ollama.js';
import { OpenAIChat } from '../src/core/llm/openai.js';
import type { LlmProvider } from '../src/core/llm/provider.js';
import { createLogger } from '../src/lib/logger.js';

const logger = createLogger('silent', false);

/** Builds a container from env vars only, exactly like the real server boot. */
const boot = (vars: Record<string, string>) =>
  createContainer(loadEnv({ NODE_ENV: 'test', ...vars }), logger, { persist: false });

describe('createContainer (composition root)', () => {
  it('runs fully offline by default', async () => {
    const c = await boot({});

    expect(c.embeddings).toBeInstanceOf(LocalHashEmbeddings);
    expect(c.llm).toBeInstanceOf(ExtractiveAnswerer);
  });

  it.each([
    ['openai', 'openai', OpenAIEmbeddings, OpenAIChat],
    ['ollama', 'ollama', OllamaEmbeddings, OllamaChat],
    ['local', 'openai', LocalHashEmbeddings, OpenAIChat],
    ['ollama', 'extractive', OllamaEmbeddings, ExtractiveAnswerer],
  ] as const)(
    'EMBEDDINGS_PROVIDER=%s + LLM_PROVIDER=%s wires the matching implementations',
    async (embeddingsProvider, llmProvider, EmbeddingsClass, LlmClass) => {
      const c = await boot({
        EMBEDDINGS_PROVIDER: embeddingsProvider,
        LLM_PROVIDER: llmProvider,
        OPENAI_API_KEY: 'test-key',
      });

      expect(c.embeddings).toBeInstanceOf(EmbeddingsClass);
      expect(c.llm).toBeInstanceOf(LlmClass);
    },
  );

  it('passes the configured model names through to the providers', async () => {
    const c = await boot({
      EMBEDDINGS_PROVIDER: 'openai',
      LLM_PROVIDER: 'ollama',
      OPENAI_API_KEY: 'test-key',
      OPENAI_EMBED_MODEL: 'embed-x',
      OLLAMA_CHAT_MODEL: 'chat-y',
    });

    expect(c.embeddings.name).toBe('openai:embed-x');
    expect(c.llm.name).toBe('ollama:chat-y');
  });

  it('lets explicit overrides win over env (used for test doubles)', async () => {
    const fake: LlmProvider = {
      name: 'fake',
      async *stream() {
        yield 'hi';
      },
    };

    const c = await createContainer(loadEnv({ NODE_ENV: 'test', LLM_PROVIDER: 'ollama' }), logger, {
      llm: fake,
      persist: false,
    });

    expect(c.llm).toBe(fake);
  });
});

describe('loadEnv edge cases', () => {
  it('treats blank values as unset so an empty .env line falls back to defaults', () => {
    const env = loadEnv({ TOP_K: '', LLM_PROVIDER: '', CHUNK_SIZE: '' });

    expect(env).toMatchObject({ TOP_K: 5, LLM_PROVIDER: 'extractive', CHUNK_SIZE: 800 });
  });

  it('coerces numeric strings from the environment', () => {
    expect(loadEnv({ PORT: '3001', MIN_SCORE: '0.3' })).toMatchObject({
      PORT: 3001,
      MIN_SCORE: 0.3,
    });
  });

  it('lists every invalid variable in one error, not just the first', () => {
    expect(() => loadEnv({ PORT: 'abc', LLM_PROVIDER: 'gpt', TOP_K: '999' })).toThrow(
      /PORT[\s\S]*LLM_PROVIDER[\s\S]*TOP_K/,
    );
  });

  it.each([
    ['CHUNK_SIZE', '50'],
    ['CHUNK_SIZE', '9000'],
    ['TOP_K', '0'],
    ['MIN_SCORE', '2'],
    ['MAX_UPLOAD_MB', '-1'],
    ['OPENAI_BASE_URL', 'not-a-url'],
  ])('rejects out-of-range %s=%s at boot', (key, value) => {
    expect(() => loadEnv({ [key]: value })).toThrow(new RegExp(key));
  });

  it('requires an OpenAI key when only embeddings use OpenAI', () => {
    expect(() => loadEnv({ EMBEDDINGS_PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY/);
  });

  it('does not require an OpenAI key for Ollama', () => {
    expect(() => loadEnv({ EMBEDDINGS_PROVIDER: 'ollama', LLM_PROVIDER: 'ollama' })).not.toThrow();
  });
});
