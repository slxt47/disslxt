import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, asc, count, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { MAX_PASSKEYS, PASSKEY_CHALLENGE_TTL_MINUTES, type PasskeyDto } from '@disslxt/shared';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { passkeyChallenges, passkeys, users } from '../db/schema.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import type { AuthResult, AuthService } from './auth.service.js';
import { toUserDto } from './dto.js';

const rejected = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'Dieser Passkey wurde nicht erkannt');

const toDto = (p: typeof passkeys.$inferSelect): PasskeyDto => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt.toISOString(),
  lastUsedAt: p.lastUsedAt?.toISOString() ?? null,
});

const transportsOf = (p: typeof passkeys.$inferSelect): AuthenticatorTransportFuture[] =>
  p.transports ? (p.transports.split(',') as AuthenticatorTransportFuture[]) : [];

/** Sign-in with a device key. The device checks the person, so no password or code follows. */
export class PasskeyService {
  private readonly rpID: string;
  private readonly origins: string[];

  constructor(
    private readonly db: Database,
    private readonly auth: AuthService,
    config: Pick<Config, 'publicUrl' | 'allowedOrigins'>,
  ) {
    this.rpID = new URL(config.publicUrl ?? 'http://localhost').hostname;
    this.origins = [
      ...new Set([...(config.publicUrl ? [config.publicUrl] : []), ...config.allowedOrigins]),
    ];
  }

  async list(userId: string): Promise<PasskeyDto[]> {
    const rows = await this.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt));
    return rows.map(toDto);
  }

  private async remember(challenge: string, userId: string | null): Promise<string> {
    await this.db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, sql`now()`));
    const [row] = await this.db
      .insert(passkeyChallenges)
      .values({
        challenge,
        userId,
        expiresAt: new Date(Date.now() + PASSKEY_CHALLENGE_TTL_MINUTES * 60_000),
      })
      .returning({ id: passkeyChallenges.id });
    if (!row) throw new Error('insert returned no row');
    return row.id;
  }

  /** A challenge works once, and only for whom it was made. */
  private async take(id: string, userId: string | null): Promise<string> {
    const [row] = await this.db
      .delete(passkeyChallenges)
      .where(
        and(
          eq(passkeyChallenges.id, id),
          userId ? eq(passkeyChallenges.userId, userId) : isNull(passkeyChallenges.userId),
          gt(passkeyChallenges.expiresAt, sql`now()`),
        ),
      )
      .returning({ challenge: passkeyChallenges.challenge });
    if (!row) throw rejected();
    return row.challenge;
  }

  /** Adding one needs the password: a borrowed session must not plant a lasting way in. */
  async registrationOptions(userId: string, password: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw notFound('Konto nicht gefunden');
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Das Passwort stimmt nicht');
    }
    const existing = await this.db.select().from(passkeys).where(eq(passkeys.userId, userId));
    if (existing.length >= MAX_PASSKEYS)
      throw conflict('CONFLICT', `Höchstens ${MAX_PASSKEYS} Passkeys`);
    const options = await generateRegistrationOptions({
      rpName: 'disslxt',
      rpID: this.rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.username,
      userDisplayName: user.displayName ?? user.username,
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({
        id: p.credentialId,
        transports: transportsOf(p),
      })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return { challengeId: await this.remember(options.challenge, userId), options };
  }

  async register(
    userId: string,
    challengeId: string,
    response: RegistrationResponseJSON,
    name: string,
  ): Promise<PasskeyDto> {
    const expectedChallenge = await this.take(challengeId, userId);
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    }).catch(() => null);
    if (!result?.verified) throw rejected();
    const { credential } = result.registrationInfo;
    const [have] = await this.db
      .select({ n: count() })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
    if ((have?.n ?? 0) >= MAX_PASSKEYS)
      throw conflict('CONFLICT', `Höchstens ${MAX_PASSKEYS} Passkeys`);
    const [row] = await this.db
      .insert(passkeys)
      .values({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: (credential.transports ?? []).join(','),
        name,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('CONFLICT', 'Dieser Passkey ist schon eingetragen');
    return toDto(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const gone = await this.db
      .delete(passkeys)
      .where(and(eq(passkeys.id, id), eq(passkeys.userId, userId)))
      .returning({ id: passkeys.id });
    if (gone.length === 0) throw notFound('Passkey nicht gefunden');
  }

  async loginOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
    });
    return { challengeId: await this.remember(options.challenge, null), options };
  }

  async login(
    challengeId: string,
    response: AuthenticationResponseJSON,
    device: string | null,
  ): Promise<AuthResult> {
    const expectedChallenge = await this.take(challengeId, null);
    const [row] = await this.db
      .select({ key: passkeys, user: users })
      .from(passkeys)
      .innerJoin(users, eq(users.id, passkeys.userId))
      .where(eq(passkeys.credentialId, response.id))
      .limit(1);
    if (!row) throw rejected();
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
      requireUserVerification: true,
      credential: {
        id: row.key.credentialId,
        publicKey: Buffer.from(row.key.publicKey, 'base64url'),
        counter: row.key.counter,
        transports: transportsOf(row.key),
      },
    }).catch(() => null);
    if (!result?.verified) throw rejected();
    await this.db
      .update(passkeys)
      .set({ counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeys.id, row.key.id));
    const token = await this.auth.createSession(row.user.id, device);
    return { user: toUserDto(row.user), token };
  }
}
