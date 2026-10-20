import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';

export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://chat:chat@localhost:5432/chat_mvp_test';
  const handle = createDb(url, { max: 1 });
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}
