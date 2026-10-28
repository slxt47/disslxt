import { eq } from 'drizzle-orm';
import type { UpdateProfileInput, UserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { AppError, notFound } from '../lib/errors.js';
import type { ImageStore } from '../lib/images.js';
import type { Hub } from '../realtime/hub.js';
import { toPublicUser, toUserDto } from './dto.js';
import type { FriendService } from './friend.service.js';
import type { GuildService } from './guild.service.js';

/** Profile settings: display name and picture. Changes reach everyone who sees the user. */
export class UserService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly guilds: GuildService,
    private readonly friends: FriendService,
    private readonly images: ImageStore,
  ) {}

  /** Only the fields that are given change (see updateProfileSchema). */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<UserDto> {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.statusEmoji !== undefined) patch.statusEmoji = input.statusEmoji;
    if (input.statusText !== undefined) patch.statusText = input.statusText;
    if (input.tagGuildId === null) {
      Object.assign(patch, { tagGuildId: null, tagText: null, tagEmoji: null });
    } else if (input.tagGuildId !== undefined) {
      const guild = await this.guilds.assertMember(userId, input.tagGuildId);
      if (!guild.tag) throw new AppError('BAD_REQUEST', 400, 'Dieser Server hat keinen Tag');
      Object.assign(patch, { tagGuildId: guild.id, tagText: guild.tag, tagEmoji: guild.tagEmoji });
    }
    if (Object.keys(patch).length === 0) return toUserDto(await this.current(userId));
    return this.update(userId, patch);
  }

  /** Announces the current profiles of these users again (after a server tag changed). */
  async republish(userIds: string[]): Promise<void> {
    for (const id of userIds) {
      const row = await this.current(id).catch(() => null);
      if (!row) continue;
      const [guildIds, friendIds] = await Promise.all([
        this.guilds.guildIdsForUser(id),
        this.friends.friendIds(id),
      ]);
      this.hub.updateProfile(toPublicUser(row), guildIds, friendIds);
    }
  }

  /** Stores a new picture (bytes checked) and removes the previous one. */
  async setAvatar(userId: string, body: unknown): Promise<UserDto> {
    const key = await this.images.save(body);
    const old = await this.current(userId);
    try {
      const user = await this.update(userId, { avatarKey: key });
      await this.images.remove(old.avatarKey);
      return user;
    } catch (err) {
      await this.images.remove(key);
      throw err;
    }
  }

  async removeAvatar(userId: string): Promise<UserDto> {
    const old = await this.current(userId);
    const user = await this.update(userId, { avatarKey: null });
    await this.images.remove(old.avatarKey);
    return user;
  }

  /** Any signed-in user may see profile pictures (like names, they are not secret). */
  async avatar(userId: string) {
    return this.images.read((await this.current(userId)).avatarKey);
  }

  private async current(userId: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw notFound('Benutzer nicht gefunden');
    return row;
  }

  private async update(
    userId: string,
    patch: Partial<typeof users.$inferInsert>,
  ): Promise<UserDto> {
    const [row] = await this.db.update(users).set(patch).where(eq(users.id, userId)).returning();
    if (!row) throw notFound('Benutzer nicht gefunden');
    const [guildIds, friendIds] = await Promise.all([
      this.guilds.guildIdsForUser(userId),
      this.friends.friendIds(userId),
    ]);
    this.hub.updateProfile(toPublicUser(row), guildIds, friendIds);
    return toUserDto(row);
  }
}
