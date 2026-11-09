import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  DATA_DIR: z.string().default('./data'),

  EMBEDDINGS_PROVIDER: z.enum(['local', 'openai', 'ollama']).default('local'),
  LLM_PROVIDER: z.enum(['extractive', 'openai', 'ollama']).default('extractive'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBED_MODEL: z.string().default('text-embedding-3-small'),

  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
  OLLAMA_CHAT_MODEL: z.string().default('llama3.1'),
  OLLAMA_EMBED_MODEL: z.string().default('nomic-embed-text'),

  CHUNK_SIZE: z.coerce.number().int().min(100).max(8000).default(800),
  CHUNK_OVERLAP: z.coerce.number().int().min(0).default(120),
  TOP_K: z.coerce.number().int().min(1).max(50).default(5),
  MIN_SCORE: z.coerce.number().min(-1).max(1).default(0.15),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat empty strings as "unset" so blank lines in .env fall back to defaults.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );

  const parsed = EnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }

  const env = parsed.data;

  if (env.CHUNK_OVERLAP >= env.CHUNK_SIZE) {
    throw new Error('CHUNK_OVERLAP must be smaller than CHUNK_SIZE');
  }
  const needsOpenAI = env.EMBEDDINGS_PROVIDER === 'openai' || env.LLM_PROVIDER === 'openai';
  if (needsOpenAI && !env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when an OpenAI provider is selected');
  }

  return env;
}
