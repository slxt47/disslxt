import type { FastifyInstance } from 'fastify';
import {
  AVATAR_MAX_BYTES,
  banSchema,
  createGuildSchema,
  createRoleSchema,
  deleteGuildSchema,
  inviteSettingsSchema,
  memberRolesSchema,
  roleOrderSchema,
  updateGuildSchema,
  updateRoleSchema,
  uuidSchema,
} from '@disslxt/shared';
import { acceptImageUploads, sendImage } from '../lib/imageReply.js';
import { currentUser } from '../plugins/auth.js';
import type { Services } from '../services/index.js';
import { parse, parseParam } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';

type GuildParams = { Params: { guildId: string } };
type RoleParams = { Params: { guildId: string; roleId: string } };
type MemberParams = { Params: { guildId: string; userId: string } };
const guildId = (p: { guildId: string }) =>
  parseParam(uuidSchema, p.guildId, () => notFound('Server nicht gefunden'));

const someId = (id: string, what: string) => parseParam(uuidSchema, id, () => notFound(what));

/** All routes in this plugin require auth (registered inside the protected scope). */
export async function guildRoutes(
  app: FastifyInstance,
  opts: { services: Services },
): Promise<void> {
  const { guilds, roles } = opts.services;
  acceptImageUploads(app);

  app.get('/guilds', async (req) => ({ guilds: await guilds.listForUser(currentUser(req).id) }));

  app.post('/guilds', async (req, reply) => {
    const { name } = parse(createGuildSchema, req.body);
    const result = await guilds.create(currentUser(req), name);
    return reply.status(201).send(result);
  });

  app.get<GuildParams>('/guilds/:guildId', async (req) => ({
    guild: await guilds.get(currentUser(req).id, guildId(req.params)),
  }));

  app.post<GuildParams>('/guilds/:guildId/leave', async (req, reply) => {
    await guilds.leave(currentUser(req).id, guildId(req.params));
    return reply.status(204).send();
  });

  app.delete<GuildParams>('/guilds/:guildId', async (req, reply) => {
    const { name } = parse(deleteGuildSchema, req.body);
    await guilds.delete(currentUser(req).id, guildId(req.params), name);
    return reply.status(204).send();
  });

  // Server settings (owner only, checked in the service).
  app.patch<GuildParams>('/guilds/:guildId', async (req) => {
    const patch = parse(updateGuildSchema, req.body);
    return { guild: await guilds.update(currentUser(req).id, guildId(req.params), patch) };
  });

  app.post<GuildParams>('/guilds/:guildId/invite', async (req) => {
    const settings = parse(inviteSettingsSchema, req.body);
    return { guild: await guilds.updateInvite(currentUser(req).id, guildId(req.params), settings) };
  });

  app.put<GuildParams>(
    '/guilds/:guildId/icon',
    { onRequest: app.requireAuth, bodyLimit: AVATAR_MAX_BYTES },
    async (req) => ({
      guild: await guilds.setIcon(currentUser(req).id, guildId(req.params), req.body),
    }),
  );

  app.delete<GuildParams>('/guilds/:guildId/icon', async (req) => ({
    guild: await guilds.removeIcon(currentUser(req).id, guildId(req.params)),
  }));

  app.get<GuildParams>('/guilds/:guildId/icon', async (req, reply) =>
    sendImage(reply, await guilds.icon(currentUser(req).id, guildId(req.params))),
  );

  app.get<GuildParams>('/guilds/:guildId/members', async (req) => ({
    members: await guilds.members(currentUser(req).id, guildId(req.params)),
  }));

  // Roles (owner only, checked in the service).
  app.get<GuildParams>('/guilds/:guildId/roles', async (req) =>
    roles.list(currentUser(req).id, guildId(req.params)),
  );

  app.post<GuildParams>('/guilds/:guildId/roles', async (req, reply) => {
    const input = parse(createRoleSchema, req.body);
    const role = await roles.create(currentUser(req).id, guildId(req.params), input);
    return reply.status(201).send({ role });
  });

  app.put<GuildParams>('/guilds/:guildId/roles/order', async (req, reply) => {
    const { roleIds } = parse(roleOrderSchema, req.body);
    await roles.reorder(currentUser(req).id, guildId(req.params), roleIds);
    return reply.status(204).send();
  });

  app.patch<RoleParams>('/guilds/:guildId/roles/:roleId', async (req) => {
    const patch = parse(updateRoleSchema, req.body);
    const id = someId(req.params.roleId, 'Rolle nicht gefunden');
    return { role: await roles.update(currentUser(req).id, guildId(req.params), id, patch) };
  });

  app.delete<RoleParams>('/guilds/:guildId/roles/:roleId', async (req, reply) => {
    const id = someId(req.params.roleId, 'Rolle nicht gefunden');
    await roles.delete(currentUser(req).id, guildId(req.params), id);
    return reply.status(204).send();
  });

  app.put<MemberParams>('/guilds/:guildId/members/:userId/roles', async (req, reply) => {
    const { roleIds } = parse(memberRolesSchema, req.body);
    const id = someId(req.params.userId, 'Mitglied nicht gefunden');
    await roles.setMemberRoles(currentUser(req).id, guildId(req.params), id, roleIds);
    return reply.status(204).send();
  });

  // Moderation (kick_members / ban_members and a higher rank, checked in the service).
  app.delete<MemberParams>('/guilds/:guildId/members/:userId', async (req, reply) => {
    const id = someId(req.params.userId, 'Mitglied nicht gefunden');
    await guilds.kick(currentUser(req).id, guildId(req.params), id);
    return reply.status(204).send();
  });

  app.get<GuildParams>('/guilds/:guildId/bans', async (req) => ({
    bans: await roles.bans(currentUser(req).id, guildId(req.params)),
  }));

  app.post<GuildParams>('/guilds/:guildId/bans', async (req, reply) => {
    const { userId } = parse(banSchema, req.body);
    await guilds.ban(currentUser(req).id, guildId(req.params), userId);
    return reply.status(204).send();
  });

  app.delete<MemberParams>('/guilds/:guildId/bans/:userId', async (req, reply) => {
    const id = someId(req.params.userId, 'Sperre nicht gefunden');
    await guilds.unban(currentUser(req).id, guildId(req.params), id);
    return reply.status(204).send();
  });
}
