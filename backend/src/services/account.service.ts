import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, inArray, ne, or } from 'drizzle-orm';
import { WS_CLOSE } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import {
  channels,
  dmMembers,
  friendships,
  guildMembers,
  guilds,
  messages,
  users,
} from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { ImageStore } from '../lib/images.js';
import { verifyPassword } from '../lib/password.js';
import type { Hub } from '../realtime/hub.js';
import type { ChannelService } from './channel.service.js';
import type { DmService } from './dm.service.js';
import type { GuildService } from './guild.service.js';
import type { StorageService } from './storage.service.js';

/**
 * Deleting your own account (right to erasure, Art. 17 GDPR). Everything that belongs to the
 * account goes: servers you own (with all their content), your messages and files everywhere,
 * private chats, friendships, sessions and push subscriptions. Everyone affected is told live.
 * The user row is removed last, so a failure half way leaves an account that can simply retry.
 */
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly channels: ChannelService,
    private readonly dms: DmService,
    private readonly images: ImageStore,
    private readonly storage: StorageService,
    private readonly uploads: { voiceDir: string; fileDir: string },
  ) {}

  async delete(userId: string, password: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw notFound('Konto nicht gefunden');
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Das Passwort stimmt nicht');
    }

    // 1) Own servers: deleted with everything in them (not handed on).
    const owned = await this.db
      .select({ id: guilds.id, name: guilds.name })
      .from(guilds)
      .where(eq(guilds.ownerId, userId));
    for (const g of owned) {
      await this.guilds.delete(userId, g.id, g.name);
    }
    // 2) Other servers: leave them (members see you go, a worn tag disappears).
    const memberOf = await this.db
      .select({ guildId: guildMembers.guildId })
      .from(guildMembers)
      .where(eq(guildMembers.userId, userId));
    for (const m of memberOf) await this.guilds.leave(userId, m.guildId);

    // 3) Private conversations: leave groups (owner role passes on), drop 1:1 chats entirely –
    //    without you the other person could no longer open them anyway.
    const mine = await this.db
      .select({ id: channels.id, kind: channels.kind })
      .from(dmMembers)
      .innerJoin(channels, eq(channels.id, dmMembers.channelId))
      .where(eq(dmMembers.userId, userId));
    for (const c of mine.filter((c) => c.kind === 'group')) {
      await this.dms.removeMember(userId, c.id, userId);
    }
    const direct = mine.filter((c) => c.kind === 'dm').map((c) => c.id);
    if (direct.length > 0) {
      const peers = await this.db
        .select({ channelId: dmMembers.channelId, userId: dmMembers.userId })
        .from(dmMembers)
        .where(and(inArray(dmMembers.channelId, direct), ne(dmMembers.userId, userId)));
      const files = await this.filesOf(inArray(messages.channelId, direct));
      await this.db.delete(channels).where(inArray(channels.id, direct));
      for (const p of peers) {
        this.hub.leaveConversation(p.userId, p.channelId);
        this.hub.publishToUsers([p.userId], {
          type: 'dm.removed',
          data: { channelId: p.channelId },
        });
      }
      await this.removeFiles(files);
    }

    // 4) Your messages everywhere else (group chats you just left keep running without them).
    const rest = await this.db
      .select({
        id: messages.id,
        channelId: messages.channelId,
        kind: channels.kind,
        audioKey: messages.audioKey,
        fileKey: messages.fileKey,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.authorId, userId));
    if (rest.length > 0) {
      await this.db.delete(messages).where(eq(messages.authorId, userId));
      for (const m of rest) {
        await this.channels.publish(
          { id: m.channelId, kind: m.kind },
          { type: 'message.deleted', data: { id: m.id.toString(), channelId: m.channelId } },
        );
      }
      await this.removeFiles(rest);
    }

    // 5) Friends and requests disappear on the other side.
    const relations = await this.db
      .select()
      .from(friendships)
      .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId)));
    for (const f of relations) {
      const other = f.requesterId === userId ? f.addresseeId : f.requesterId;
      if (f.status === 'accepted') this.hub.setFriends(userId, other, false);
      this.hub.publishToUsers([other], { type: 'friend.removed', data: { userId } });
    }

    // 6) The account itself; sessions, memberships, friendships, push subscriptions and reset
    //    links go with it (FK cascade). Then every open tab of it is signed out.
    await this.db.delete(users).where(eq(users.id, userId));
    await this.images.remove(user.avatarKey);
    this.storage.changed();
    for (const c of this.hub.allClients()) {
      if (c.userId === userId) c.socket.close(WS_CLOSE.UNAUTHORIZED, 'account deleted');
    }
  }

  private filesOf(where: ReturnType<typeof eq>) {
    return this.db
      .select({ audioKey: messages.audioKey, fileKey: messages.fileKey })
      .from(messages)
      .where(where);
  }

  private async removeFiles(files: { audioKey: string | null; fileKey: string | null }[]) {
    await Promise.all(
      files.flatMap((f) => [
        ...(f.audioKey ? [rm(join(this.uploads.voiceDir, f.audioKey), { force: true })] : []),
        ...(f.fileKey ? [rm(join(this.uploads.fileDir, f.fileKey), { force: true })] : []),
      ]),
    );
  }
}
