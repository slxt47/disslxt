import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadDotEnv } from '../config.js';
import { createDb, type Database } from './client.js';

/**
 * Locates the committed migrations folder. Works both from source (src/db/migrate.ts →
 * ../../drizzle) and from the bundled server (dist/server.js → ../drizzle).
 */
export function migrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return process.env.MIGRATIONS_DIR;
  const candidates = ['../drizzle', '../../drizzle'].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const found = candidates.find((dir) => existsSync(`${dir}/meta/_journal.json`));
  if (!found) throw new Error(`Migrations folder not found (tried ${candidates.join(', ')})`);
  return found;
}

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const handle = createDb(url, { max: 1 });
  try {
    await runMigrations(handle.db);
    process.stdout.write('Migrations applied.\n');
  } finally {
    await handle.close();
  }
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isEntry) {
  main().catch((err: unknown) => {
    process.stderr.write(`Migration failed: ${String(err)}\n`);
    process.exit(1);
  });
}
