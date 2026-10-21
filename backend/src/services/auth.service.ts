import { and, eq, gt, sql } from 'drizzle-orm';
import type { LoginInput, RegisterInput, UserDto } from '@disslxt/shared';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { conflict, invalidCredentials } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { isUniqueViolation } from '../lib/pgErrors.js';
import { randomToken, sha256 } from '../lib/tokens.js';
import { toUserDto } from './dto.js';

export interface AuthResult {
  user: UserDto;
  token: string;
}

export class AuthService {
  /** Hash used to equalise timing for unknown e-mails. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: Database,
    private readonly config: Pick<Config, 'sessionTtlDays'>,
  ) {}

  async register(input: RegisterInput): Promise<AuthResult> {
    const passwordHash = await hashPassword(input.password);
    let row;
    try {
      [row] = await this.db
        .insert(users)
        .values({ email: input.email.toLowerCase(), username: input.username, passwordHash })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('EMAIL_TAKEN', 'Diese E-Mail-Adresse ist bereits registriert');
      }
      throw err;
    }
    if (!row) throw new Error('insert returned no row');
    const token = await this.createSession(row.id);
    return { user: toUserDto(row), token };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, input.email.toLowerCase()))
      .limit(1);
    if (!row) {
      // Spend the same time as a real verification so unknown e-mails are not detectable.
      await verifyPassword(await this.getDummyHash(), input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(row.passwordHash, input.password))) throw invalidCredentials();
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
    const expiresAt = new Date(Date.now() + this.config.sessionTtlDays * 24 * 60 * 60 * 1000);
    await this.db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt });
    return token;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomToken());
    return this.dummyHash;
  }
}
