import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

/** Creates a pg pool (max 20 connections) and a Drizzle instance on top of it. */
export function createDb(url: string, opts: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 20 });
  // Prevent unhandled 'error' events from idle clients from crashing the process.
  pool.on('error', () => {});
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
