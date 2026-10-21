import { z } from 'zod';
import {
  CHANNEL_NAME_MAX_LEN,
  EMAIL_MAX_LEN,
  GUILD_NAME_MAX_LEN,
  MESSAGE_MAX_LEN,
  NEXT_PATH_MAX_LEN,
  PAGE_DEFAULT,
  PAGE_MAX,
  PASSWORD_MAX_LEN,
  PASSWORD_MIN_LEN,
  USERNAME_MAX_LEN,
  USERNAME_MIN_LEN,
} from './constants.js';
import { MESSAGE_DISALLOWED_CHARS, NAME_DISALLOWED_CHARS, textLength } from './text.js';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LEN, 'E-Mail ist zu lang')
  .pipe(z.email('Ungültige E-Mail-Adresse'));

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LEN, `Benutzername muss mindestens ${USERNAME_MIN_LEN} Zeichen haben`)
  .max(USERNAME_MAX_LEN, `Benutzername darf höchstens ${USERNAME_MAX_LEN} Zeichen haben`)
  .regex(/^[A-Za-z0-9_]+$/, 'Nur Buchstaben, Ziffern und _ erlaubt');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LEN, `Passwort muss mindestens ${PASSWORD_MIN_LEN} Zeichen haben`)
  .max(PASSWORD_MAX_LEN, `Passwort darf höchstens ${PASSWORD_MAX_LEN} Zeichen haben`);

/**
 * In-app path to continue at after the e-mail is confirmed (e.g. an invite link). Only plain
 * same-origin paths are accepted, so a confirmation can never redirect off-site.
 */
export const nextPathSchema = z
  .string()
  .max(NEXT_PATH_MAX_LEN)
  .regex(/^\/(?![/\\])[A-Za-z0-9/_\-.~%?=&]*$/, 'Ungültiges Weiterleitungsziel');

export const registerSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  next: nextPathSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/** Token from the confirmation link: 32 random bytes, base64url (43 chars). */
export const verifyEmailSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Ungültiger Bestätigungslink'),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.object({ email: emailSchema });
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Passwort fehlt').max(PASSWORD_MAX_LEN),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createGuildSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name fehlt')
    .refine(
      (s) => textLength(s) <= GUILD_NAME_MAX_LEN,
      `Name darf höchstens ${GUILD_NAME_MAX_LEN} Zeichen haben`,
    )
    .refine((s) => !NAME_DISALLOWED_CHARS.test(s), 'Name enthält unzulässige Steuerzeichen'),
});
export type CreateGuildInput = z.infer<typeof createGuildSchema>;

/** Normalises a channel name: trimmed, lowercased, whitespace runs become "-". */
export function normalizeChannelName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-');
}

export const channelNameSchema = z
  .string()
  .transform(normalizeChannelName)
  .pipe(
    z
      .string()
      .regex(
        new RegExp(`^[a-z0-9-]{1,${CHANNEL_NAME_MAX_LEN}}$`),
        `Kanalname: 1–${CHANNEL_NAME_MAX_LEN} Zeichen, nur a–z, 0–9 und -`,
      ),
  );

export const createChannelSchema = z.object({ name: channelNameSchema });
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const messageContentSchema = z
  .string()
  .trim()
  .min(1, 'Nachricht ist leer')
  .refine(
    (s) => textLength(s) <= MESSAGE_MAX_LEN,
    `Nachricht darf höchstens ${MESSAGE_MAX_LEN} Zeichen haben`,
  )
  .refine((s) => !MESSAGE_DISALLOWED_CHARS.test(s), 'Nachricht enthält unzulässige Steuerzeichen');

export const sendMessageSchema = z.object({ content: messageContentSchema });
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({ content: messageContentSchema });
export type EditMessageInput = z.infer<typeof editMessageSchema>;

/** Message ids are bigint, transported as decimal strings. */
const BIGINT_MAX = 9223372036854775807n;
export const messageIdSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/, 'Ungültige Nachrichten-ID')
  .refine((s) => !/^\d+$/.test(s) || BigInt(s) <= BIGINT_MAX, 'Ungültige Nachrichten-ID');

export const listMessagesQuery = z.object({
  before: messageIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_MAX).default(PAGE_DEFAULT),
});
export type ListMessagesQuery = z.infer<typeof listMessagesQuery>;

export const inviteCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{1,16}$/, 'Ungültiger Einladungscode');

export const uuidSchema = z.guid();
