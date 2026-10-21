import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { LoginInput, RegisterInput, UserDto } from '@disslxt/shared';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { mailLog, pendingRegistrations, sessions, users } from '../db/schema.js';
import { emailNotVerified, invalidCredentials, verificationInvalid } from '../lib/errors.js';
import type { Mailer, MailMessage } from '../lib/mailer.js';
import { accountExistsMail, verificationMail } from '../lib/mailTemplates.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { randomToken, sha256 } from '../lib/tokens.js';
import { toUserDto } from './dto.js';

export interface AuthResult {
  user: UserDto;
  token: string;
}

export interface VerifyResult extends AuthResult {
  /** In-app path the user wanted to reach when registering (e.g. an invite), if any. */
  next: string | null;
}

type MailKind = 'verification' | 'account_exists';

const MAIL_ATTEMPTS = 3;
const MAIL_RETRY_BASE_MS = 2000;

export class AuthService {
  /** Hash used to equalise timing for unknown e-mails. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Database,
    private readonly config: Pick<Config, 'sessionTtlDays' | 'publicUrl' | 'mail'>,
    private readonly mailer: Mailer,
    private readonly log: FastifyBaseLogger,
  ) {}

  /**
   * Starts a registration. The answer is the same whether or not the address already has an
   * account; the mailbox owner gets a confirmation link or an "account exists" notice. No
   * account and no session exist until the link is used.
   */
  async register(input: RegisterInput): Promise<void> {
    // Hash first in every branch so the response time does not reveal which branch ran.
    const passwordHash = await hashPassword(input.password);
    const email = input.email.toLowerCase();
    await this.deleteExpired();

    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);
    if (existing) {
      if (await this.reserveMailSlot(email, 'account_exists')) {
        this.dispatch(
          'account_exists',
          accountExistsMail({ to: email, loginLink: `${this.config.publicUrl}/login` }),
        );
      }
      return;
    }

    if (!(await this.reserveMailSlot(email, 'verification'))) return;
    const token = randomToken();
    await this.db.insert(pendingRegistrations).values({
      email,
      username: input.username,
      passwordHash,
      tokenHash: sha256(token),
      nextPath: input.next ?? null,
      expiresAt: this.verificationExpiry(),
    });
    this.dispatch('verification', this.verificationMailFor(email, input.username, token));
  }

  /**
   * Redeems a confirmation link: creates the account from the pending registration the link
   * belongs to, drops every other pending registration for that address and logs the user in.
   */
  async verifyEmail(token: string): Promise<VerifyResult> {
    return this.db.transaction(async (tx) => {
      const [pending] = await tx
        .select()
        .from(pendingRegistrations)
        .where(
          and(
            eq(pendingRegistrations.tokenHash, sha256(token)),
            gt(pendingRegistrations.expiresAt, sql`now()`),
          ),
        )
        .for('update')
        .limit(1);
      if (!pending) throw verificationInvalid();

      const [row] = await tx
        .insert(users)
        .values({
          email: pending.email,
          username: pending.username,
          passwordHash: pending.passwordHash,
          emailVerifiedAt: sql`now()`,
        })
        .onConflictDoNothing()
        .returning();
      await tx
        .delete(pendingRegistrations)
        .where(eq(sql`lower(${pendingRegistrations.email})`, pending.email.toLowerCase()));
      if (!row) {
        // Another link for the same address was used first; that account stays as it is.
        throw verificationInvalid(
          'Diese E-Mail-Adresse ist bereits bestätigt. Bitte melde dich an.',
        );
      }

      const sessionToken = randomToken();
      await tx.insert(sessions).values({
        userId: row.id,
        tokenHash: sha256(sessionToken),
        expiresAt: this.sessionExpiry(),
      });
      return { user: toUserDto(row), token: sessionToken, next: pending.nextPath };
    });
  }

  /**
   * Sends a fresh link for the newest open registration of this address (the previous link of
   * that registration stops working). Silent when there is nothing to confirm or the
   * per-address limit is reached, so the answer reveals nothing.
   */
  async resendVerification(rawEmail: string): Promise<void> {
    const email = rawEmail.toLowerCase();
    const [pending] = await this.db
      .select()
      .from(pendingRegistrations)
      .where(
        and(
          eq(sql`lower(${pendingRegistrations.email})`, email),
          gt(pendingRegistrations.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(pendingRegistrations.createdAt))
      .limit(1);
    if (!pending) return;
    if (!(await this.reserveMailSlot(email, 'verification'))) return;

    const token = randomToken();
    await this.db
      .update(pendingRegistrations)
      .set({ tokenHash: sha256(token), expiresAt: this.verificationExpiry() })
      .where(eq(pendingRegistrations.id, pending.id));
    this.dispatch('verification', this.verificationMailFor(email, pending.username, token));
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const email = input.email.toLowerCase();
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email))
      .limit(1);
    if (!row) {
      // Exactly one password verification in every branch, so timing reveals nothing. Only
      // someone who knows the password of an open registration learns that it awaits
      // confirmation.
      const [pending] = await this.db
        .select({ passwordHash: pendingRegistrations.passwordHash })
        .from(pendingRegistrations)
        .where(
          and(
            eq(sql`lower(${pendingRegistrations.email})`, email),
            gt(pendingRegistrations.expiresAt, sql`now()`),
          ),
        )
        .orderBy(desc(pendingRegistrations.createdAt))
        .limit(1);
      const hash = pending?.passwordHash ?? (await this.getDummyHash());
      const ok = await verifyPassword(hash, input.password);
      if (pending && ok) throw emailNotVerified();
      throw invalidCredentials();
    }
    if (!(await verifyPassword(row.passwordHash, input.password))) throw invalidCredentials();
    if (!row.emailVerifiedAt) throw emailNotVerified();
    const token = await this.createSession(row.id);
    return { user: toUserDto(row), token };
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  }

  async getUserBySession(token: string): Promise<UserDto | null> {
    const [row] = await this.db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, sql`now()`)))
      .limit(1);
    return row ?? null;
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomToken();
    await this.db
      .insert(sessions)
      .values({ userId, tokenHash: sha256(token), expiresAt: this.sessionExpiry() });
    return token;
  }

  private sessionExpiry(): Date {
    return new Date(Date.now() + this.config.sessionTtlDays * 24 * 60 * 60 * 1000);
  }

  private verificationExpiry(): Date {
    return new Date(Date.now() + this.config.mail.verificationTtlHours * 60 * 60 * 1000);
  }

  private verificationMailFor(email: string, username: string, token: string): MailMessage {
    return verificationMail({
      to: email,
      username,
      // Token in the fragment: it never reaches server logs, proxies or Referer headers.
      link: `${this.config.publicUrl}/verify-email#token=${token}`,
      ttlHours: this.config.mail.verificationTtlHours,
    });
  }

  /**
   * Records a mail to this address unless the hourly per-address limit is reached. Serialised
   * per address with an advisory lock so parallel requests cannot overshoot the limit.
   */
  private async reserveMailSlot(email: string, kind: MailKind): Promise<boolean> {
    const addressHash = sha256(email);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${addressHash}))`);
      const [{ count } = { count: 0 }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(mailLog)
        .where(
          and(
            eq(mailLog.addressHash, addressHash),
            gt(mailLog.sentAt, sql`now() - interval '1 hour'`),
          ),
        );
      if (count >= this.config.mail.maxPerAddressPerHour) {
        this.log.warn({ kind }, 'per-address mail limit reached, mail not sent');
        return false;
      }
      await tx.insert(mailLog).values({ addressHash, kind });
      return true;
    });
  }

  /**
   * Sends in the background with a few retries, so the response neither waits for the SMTP
   * server nor reveals through its timing whether a mail was sent.
   */
  private dispatch(kind: MailKind, message: MailMessage): void {
    void (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          await this.mailer.send(message);
          return;
        } catch (err) {
          if (attempt >= MAIL_ATTEMPTS) {
            this.log.error({ err, kind }, 'mail delivery failed');
            return;
          }
          this.log.warn({ err, kind, attempt }, 'mail delivery failed, retrying');
          await new Promise((r) => setTimeout(r, MAIL_RETRY_BASE_MS * attempt));
        }
      }
    })();
  }

  private async deleteExpired(): Promise<void> {
    await this.db
      .delete(pendingRegistrations)
      .where(lt(pendingRegistrations.expiresAt, sql`now()`));
    await this.db.delete(mailLog).where(lt(mailLog.sentAt, sql`now() - interval '1 day'`));
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomToken());
    return this.dummyHash;
  }
}
