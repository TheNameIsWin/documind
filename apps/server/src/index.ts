import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createContainer } from './container.js';
import { createLogger } from './lib/logger.js';

async function main() {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  const container = await createContainer(env, logger);
  const app = createApp(container);

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, embeddings: container.embeddings.name, llm: container.llm.name },
      'DocuMind API listening',
    );
  });

  // Graceful shutdown: stop accepting connections, let in-flight requests finish.
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
