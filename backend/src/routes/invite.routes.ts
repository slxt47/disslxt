import type { FastifyInstance } from 'fastify';
import { inviteCodeSchema } from '@chat-mvp/shared';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parseParam } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

type InviteParams = { Params: { code: string } };
const code = (p: { code: string }) =>
  parseParam(inviteCodeSchema, p.code, () =>
    notFound('Einladung ungültig oder abgelaufen', 'INVITE_NOT_FOUND'),
  );

export async function inviteRoutes(
  app: FastifyInstance,
  opts: { services: Services },
): Promise<void> {
  const { guilds } = opts.services;

  app.get<InviteParams>('/invites/:code', async (req) =>
    guilds.invitePreview(currentUser(req).id, code(req.params)),
  );

  app.post<InviteParams>('/invites/:code/join', async (req) => ({
    guild: await guilds.join(currentUser(req), code(req.params)),
  }));
}
