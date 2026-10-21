import type { ErrorCode } from '@disslxt/shared';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const validationError = (details: unknown, message = 'Ungültige Eingabe') =>
  new AppError('VALIDATION_ERROR', 400, message, details);
export const unauthorized = (message = 'Nicht angemeldet') =>
  new AppError('UNAUTHORIZED', 401, message);
export const invalidCredentials = () =>
  new AppError('INVALID_CREDENTIALS', 401, 'E-Mail oder Passwort ist falsch');
export const emailNotVerified = () =>
  new AppError(
    'EMAIL_NOT_VERIFIED',
    403,
    'Bitte bestätige zuerst deine E-Mail-Adresse. Wir haben dir einen Link geschickt.',
  );
export const verificationInvalid = (
  message = 'Der Bestätigungslink ist ungültig oder abgelaufen. Fordere einfach einen neuen an.',
) => new AppError('VERIFICATION_INVALID', 400, message);
export const forbidden = (message = 'Keine Berechtigung', code: ErrorCode = 'FORBIDDEN') =>
  new AppError(code, 403, message);
export const notFound = (message = 'Nicht gefunden', code: ErrorCode = 'NOT_FOUND') =>
  new AppError(code, 404, message);
export const conflict = (code: ErrorCode, message: string) => new AppError(code, 409, message);
