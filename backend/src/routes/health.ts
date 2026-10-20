import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/client.js';

export async function healthRoutes(app: FastifyInstance, opts: { db: Database }): Promise<void> {
  app.get('/health', async (req, reply) => {
    try {
      await opts.db.execute(sql`select 1`);
      return { status: 'ok' };
    } catch (err) {
      req.log.error({ err }, 'health check failed');
      return reply
        .status(503)
        .send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Datenbank nicht erreichbar' } });
    }
  });
}
