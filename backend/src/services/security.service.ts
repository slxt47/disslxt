import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, ne, or, sql } from 'drizzle-orm';
import {
  RECOVERY_CODE_COUNT,
  WS_CLOSE,
  type SessionDto,
  type TwoFactorSetupDto,
  type TwoFactorStatusDto,
} from '@disslxt/shared';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import {
  channels,
  friendships,
  guildMembers,
  guilds,
  loginChallenges,
  messageReactions,
  messages,
  recoveryCodes,
  sessions,
  users,
  type User,
} from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { seal, open } from '../lib/secretBox.js';
import { base32Encode, matchTotp, newTotpSecret, totpUri } from '../lib/totp.js';
import { sha256 } from '../lib/tokens.js';
import type { Hub } from '../realtime/hub.js';
import type { AuthService } from './auth.service.js';

const wrongPassword = () => new AppError('INVALID_CREDENTIALS', 401, 'Das Passwort stimmt nicht');

/** Two groups of five letters and digits, about 50 bits. */
function newRecoveryCode(): string {
  const text = base32Encode(randomBytes(7)).slice(0, 10);
  return `${text.slice(0, 5)}-${text.slice(5)}`;
}

/** Your account: second factor, signed-in devices and the copy of your data. */
export class SecurityService {
  constructor(
    private readonly db: Database,
    private readonly hub: Hub,
    private readonly auth: AuthService,
    private readonly config: Pick<Config, 'twoFactorKey'>,
  ) {}

  private async user(userId: string): Promise<User> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw notFound('Konto nicht gefunden');
    return user;
  }

  async status(userId: string): Promise<TwoFactorStatusDto> {
    const user = await this.user(userId);
    const [row] = await this.db
      .select({ n: count() })
      .from(recoveryCodes)
      .where(eq(recoveryCodes.userId, userId));
    return {
      enabled: !!user.totpEnabledAt,
      recoveryCodesLeft: row?.n ?? 0,
      available: !!this.config.twoFactorKey,
    };
  }

  /** Step 1: a new secret, not yet active. Needs the password. */
  async startSetup(userId: string, password: string): Promise<TwoFactorSetupDto> {
    const key = this.config.twoFactorKey;
    if (!key) throw new AppError('SERVICE_UNAVAILABLE', 503, 'Zwei-Faktor ist nicht eingerichtet');
    const user = await this.user(userId);
    if (!(await verifyPassword(user.passwordHash, password))) throw wrongPassword();
    if (user.totpEnabledAt) throw conflict('CONFLICT', 'Zwei-Faktor ist schon aktiv');
    const secret = newTotpSecret();
    await this.db
      .update(users)
      .set({ totpSecret: seal(secret, key), totpLastStep: 0n })
      .where(eq(users.id, userId));
    return { secret, uri: totpUri(secret, user.email) };
  }

  /** Step 2: the first code proves the app works; only then it counts. */
  async enable(userId: string, code: string): Promise<string[]> {
    const key = this.config.twoFactorKey;
    const user = await this.user(userId);
    if (user.totpEnabledAt) throw conflict('CONFLICT', 'Zwei-Faktor ist schon aktiv');
    if (!key || !user.totpSecret) throw new AppError('BAD_REQUEST', 400, 'Einrichtung fehlt');
    const step = matchTotp(open(user.totpSecret, key), code.replace(/\s/g, ''), user.totpLastStep);
    if (step === null) throw new AppError('TWO_FACTOR_INVALID', 401, 'Der Code stimmt nicht');
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ totpEnabledAt: new Date(), totpLastStep: step, totpFailures: 0 })
        .where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx
        .insert(recoveryCodes)
        .values(codes.map((c) => ({ userId, codeHash: sha256(c.replace('-', '')) })));
    });
    return codes;
  }

  private async confirm(user: User, password: string, code: string): Promise<void> {
    if (!(await verifyPassword(user.passwordHash, password))) throw wrongPassword();
    if (!user.totpEnabledAt) throw new AppError('BAD_REQUEST', 400, 'Zwei-Faktor ist nicht aktiv');
    await this.auth.checkSecondFactor(user, code);
  }

  async disable(userId: string, password: string, code: string): Promise<void> {
    await this.confirm(await this.user(userId), password, code);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ totpSecret: null, totpEnabledAt: null, totpLastStep: 0n, totpFailures: 0 })
        .where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.delete(loginChallenges).where(eq(loginChallenges.userId, userId));
    });
  }

  /** New recovery codes; the old ones stop working. */
  async newRecoveryCodes(userId: string, password: string, code: string): Promise<string[]> {
    await this.confirm(await this.user(userId), password, code);
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.db.transaction(async (tx) => {
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx
        .insert(recoveryCodes)
        .values(codes.map((c) => ({ userId, codeHash: sha256(c.replace('-', '')) })));
    });
    return codes;
  }

  async sessions(userId: string, currentToken: string): Promise<SessionDto[]> {
    const hash = sha256(currentToken);
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} > now()`))
      .orderBy(desc(sessions.lastSeenAt), desc(sessions.createdAt));
    return rows.map((s) => ({
      id: s.id,
      device: s.device,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt ? s.lastSeenAt.toISOString() : null,
      current: s.tokenHash === hash,
    }));
  }

  private endSockets(hashes: string[]): void {
    for (const hash of hashes) {
      this.hub.closeSession(hash, WS_CLOSE.UNAUTHORIZED, 'signed out');
    }
  }

  async endSession(userId: string, sessionId: string): Promise<void> {
    const gone = await this.db
      .delete(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
      .returning({ tokenHash: sessions.tokenHash });
    if (gone.length === 0) throw notFound('Sitzung nicht gefunden');
    this.endSockets(gone.map((s) => s.tokenHash));
  }

  /** "Überall abmelden": every device except this one. */
  async endOtherSessions(userId: string, currentToken: string): Promise<number> {
    const gone = await this.db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, sha256(currentToken))))
      .returning({ tokenHash: sessions.tokenHash });
    this.endSockets(gone.map((s) => s.tokenHash));
    return gone.length;
  }

  /** A copy of what the account holds (Art. 15 and 20 GDPR), without hashes and secrets. */
  async exportData(userId: string): Promise<unknown> {
    const user = await this.user(userId);
    const [servers, ownedServers, friends, written, reactions] = await Promise.all([
      this.db
        .select({ name: guilds.name, joinedAt: guildMembers.joinedAt })
        .from(guildMembers)
        .innerJoin(guilds, eq(guilds.id, guildMembers.guildId))
        .where(eq(guildMembers.userId, userId))
        .orderBy(asc(guildMembers.joinedAt)),
      this.db.select({ name: guilds.name }).from(guilds).where(eq(guilds.ownerId, userId)),
      this.db
        .select({
          username: users.username,
          status: friendships.status,
          since: friendships.createdAt,
        })
        .from(friendships)
        .innerJoin(
          users,
          sql`${users.id} = case when ${friendships.requesterId} = ${userId}::uuid then ${friendships.addresseeId} else ${friendships.requesterId} end`,
        )
        .where(or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))),
      this.db
        .select({
          id: messages.id,
          channel: channels.name,
          channelKind: channels.kind,
          kind: messages.kind,
          content: messages.content,
          fileName: messages.fileName,
          createdAt: messages.createdAt,
          editedAt: messages.editedAt,
        })
        .from(messages)
        .innerJoin(channels, eq(channels.id, messages.channelId))
        .where(eq(messages.authorId, userId))
        .orderBy(asc(messages.id)),
      this.db
        .select({
          messageId: messageReactions.messageId,
          emoji: messageReactions.emoji,
          createdAt: messageReactions.createdAt,
        })
        .from(messageReactions)
        .where(eq(messageReactions.userId, userId)),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        status: { emoji: user.statusEmoji, text: user.statusText },
        role: user.role,
        createdAt: user.createdAt,
        twoFactor: !!user.totpEnabledAt,
      },
      servers,
      ownedServers,
      friends,
      messages: written.map((m) => ({ ...m, id: m.id.toString() })),
      reactions: reactions.map((r) => ({ ...r, messageId: r.messageId.toString() })),
    };
  }
}
