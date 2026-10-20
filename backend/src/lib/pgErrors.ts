/** True if the error (or its cause, as wrapped by Drizzle) is a PostgreSQL unique violation. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    const pgErr = e as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (pgErr.code === '23505') return constraint === undefined || pgErr.constraint === constraint;
    e = pgErr.cause;
  }
  return false;
}
