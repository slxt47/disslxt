import { z } from 'zod';
import {
  CHANNEL_NAME_MAX_LEN,
  DISPLAY_NAME_MAX_LEN,
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX_LEN,
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
import { passwordProblems } from './password.js';
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

export const registerSchema = z
  .object({
    email: emailSchema,
    username: usernameSchema,
    password: passwordSchema,
    next: nextPathSchema.optional(),
  })
  .superRefine((v, ctx) => {
    for (const message of passwordProblems(v.password, { username: v.username, email: v.email })) {
      ctx.addIssue({ code: 'custom', path: ['password'], message });
    }
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

/** Deleting a guild needs its name typed again, so it cannot happen by a stray click. */
export const deleteGuildSchema = z.object({ name: z.string().max(200) });

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

/** Server settings (owner): currently the name; the picture has its own upload route. */
export const updateGuildSchema = createGuildSchema;
export type UpdateGuildInput = z.infer<typeof updateGuildSchema>;

/** Profile settings. An empty display name removes it (the username is shown again). */
export const updateProfileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .refine(
      (s) => textLength(s) <= DISPLAY_NAME_MAX_LEN,
      `Anzeigename darf höchstens ${DISPLAY_NAME_MAX_LEN} Zeichen haben`,
    )
    .refine((s) => !NAME_DISALLOWED_CHARS.test(s), 'Anzeigename enthält unzulässige Steuerzeichen')
    .transform((s) => (s === '' ? null : s))
    .nullable(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Friend request by exact username (case-insensitive). */
export const friendRequestSchema = z.object({ username: usernameSchema });
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

/** Opens (or creates) the private conversation with a friend. */
export const openDmSchema = z.object({ userId: z.guid() });
export type OpenDmInput = z.infer<typeof openDmSchema>;

const groupNameSchema = z
  .string()
  .trim()
  .refine(
    (s) => textLength(s) <= GROUP_NAME_MAX_LEN,
    `Name darf höchstens ${GROUP_NAME_MAX_LEN} Zeichen haben`,
  )
  .refine((s) => !NAME_DISALLOWED_CHARS.test(s), 'Name enthält unzulässige Steuerzeichen');

/** New group chat with friends (you count as one of the members). */
export const createGroupSchema = z.object({
  name: groupNameSchema.optional(),
  userIds: z
    .array(z.guid())
    .min(2, 'Wähle mindestens zwei Freunde – für eine Person gibt es den privaten Chat')
    .max(GROUP_MAX_MEMBERS - 1, `Höchstens ${GROUP_MAX_MEMBERS} Personen pro Gruppe`)
    .refine((ids) => new Set(ids).size === ids.length, 'Jede Person nur einmal'),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/** Empty name: the group is shown with its members' names. */
export const renameGroupSchema = z.object({ name: groupNameSchema });
export const addGroupMemberSchema = z.object({ userId: z.guid() });

/** GIPHY ids are short alphanumeric strings. */
export const gifIdSchema = z.string().regex(/^[A-Za-z0-9]{4,64}$/, 'Ungültige GIF-ID');
export const sendGifSchema = z.object({ id: gifIdSchema });
export const gifSearchQuery = z.object({
  q: z.string().trim().max(50).optional(),
  offset: z.coerce.number().int().min(0).max(499).default(0),
});

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

export const createChannelSchema = z.object({
  name: channelNameSchema,
  kind: z.enum(['text', 'voice']).default('text'),
});
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

/** Bytes relayed through TURN since the client's last report. */
export const turnUsageReportSchema = z.object({ bytes: z.number().int().min(0).max(1e10) });

/**
 * A browser push subscription (PushSubscription.toJSON()). The server POSTs to `endpoint`, so
 * only the push services of the major browsers are accepted (no requests to arbitrary hosts).
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.push.apple.com',
  '.notify.windows.com',
] as const;

export function isPushServiceUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

const base64url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+=*$/, 'Ungültiger Schlüssel');

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceUrl, 'Unbekannter Push-Dienst'),
  keys: z.object({ p256dh: base64url(80, 100), auth: base64url(16, 32) }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const pushUnsubscribeSchema = z.object({ endpoint: z.string().max(2048) });

export const guildNotificationsSchema = z.object({ muted: z.boolean() });
export type GuildNotificationsInput = z.infer<typeof guildNotificationsSchema>;
