import { buildApp } from './app.js';
import { loadConfig, loadDotEnv } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const handle = createDb(config.databaseUrl);
  await runMigrations(handle.db);

  const app = await buildApp({ config, db: handle.db });
  app.log.info('migrations applied');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      await handle.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: config.host });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exit(1);
});
