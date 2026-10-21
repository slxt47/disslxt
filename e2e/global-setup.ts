import pg from 'pg';

/**
 * Empties the E2E database before a local run. The backend (started by `webServer`) has already
 * applied the migrations on boot. Skipped for the Docker smoke run (E2E_BASE_URL).
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.E2E_BASE_URL) return;
  const url = process.env.E2E_DATABASE_URL ?? 'postgres://chat:chat@localhost:5432/disslxt_e2e';
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'TRUNCATE messages, channels, guild_members, guilds, sessions, users RESTART IDENTITY CASCADE',
    );
  } finally {
    await client.end();
  }
}
