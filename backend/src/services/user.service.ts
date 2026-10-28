import { eq } from 'drizzle-orm';
import type { UserDto } from '@disslxt/shared';
import type { Database } from '../db/client.js';
import { users } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
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

  async updateProfile(userId: string, displayName: string | null): Promise<UserDto> {
    return this.update(userId, { displayName });
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
    patch: Partial<Pick<typeof users.$inferInsert, 'displayName' | 'avatarKey'>>,
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
