import { describe, expect, it } from 'vitest';
import {
  createChannelSchema,
  createGuildSchema,
  editMessageSchema,
  inviteCodeSchema,
  listMessagesQuery,
  loginSchema,
  registerSchema,
  sendMessageSchema,
} from './schemas.js';
import { wsClientMessageSchema } from './ws.js';
import { GUILD_NAME_MAX_LEN, MESSAGE_MAX_LEN, PAGE_DEFAULT } from './constants.js';
import { textLength } from './text.js';

describe('registerSchema', () => {
  const valid = { email: 'Alice@Example.com ', username: 'alice_1', password: 'Tr0ckenBlume!' };

  it('accepts valid input and lowercases/trims the email', () => {
    const r = registerSchema.parse(valid);
    expect(r.email).toBe('alice@example.com');
    expect(r.username).toBe('alice_1');
  });

  it('rejects invalid emails', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it.each(['ab', 'a'.repeat(33), 'has space', 'umlaut-ä', 'dash-name'])(
    'rejects username %s',
    (username) => {
      expect(registerSchema.safeParse({ ...valid, username }).success).toBe(false);
    },
  );

  it('enforces password length 10–128', () => {
    expect(registerSchema.safeParse({ ...valid, password: 'Tr0cken!B' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: 'Tr0cken!Bl' }).success).toBe(true);
    const long = 'Ab1!xyz-'.repeat(16);
    expect(registerSchema.safeParse({ ...valid, password: long }).success).toBe(true);
    expect(registerSchema.safeParse({ ...valid, password: `${long}x` }).success).toBe(false);
  });

  it('reports field paths on failure', () => {
    const r = registerSchema.safeParse({ email: 'x', username: 'a', password: '1' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(expect.arrayContaining(['email', 'username', 'password']));
    }
  });
});

describe('loginSchema', () => {
  it('requires email and a non-empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.de', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.de', password: '' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.de' }).success).toBe(false);
  });
});

describe('createGuildSchema', () => {
  it('trims and enforces 1–100 chars', () => {
    expect(createGuildSchema.parse({ name: '  My Server  ' }).name).toBe('My Server');
    expect(createGuildSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createGuildSchema.safeParse({ name: 'x'.repeat(100) }).success).toBe(true);
    expect(createGuildSchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('createChannelSchema', () => {
  it('normalises names (lowercase, spaces → -)', () => {
    expect(createChannelSchema.parse({ name: '  Off Topic  ' }).name).toBe('off-topic');
    expect(createChannelSchema.parse({ name: 'Dev   Talk 2' }).name).toBe('dev-talk-2');
  });

  it.each(['', '   ', 'äöü', 'under_score', 'x'.repeat(33), 'emoji🙂'])('rejects %s', (name) => {
    expect(createChannelSchema.safeParse({ name }).success).toBe(false);
  });

  it('accepts 32 chars', () => {
    expect(createChannelSchema.safeParse({ name: 'a'.repeat(32) }).success).toBe(true);
  });
});

describe('message content', () => {
  it.each([sendMessageSchema, editMessageSchema])('trims and enforces 1–2000 chars', (schema) => {
    expect(schema.parse({ content: '  hi  ' }).content).toBe('hi');
    expect(schema.safeParse({ content: '' }).success).toBe(false);
    expect(schema.safeParse({ content: ' \n\t ' }).success).toBe(false);
    expect(schema.safeParse({ content: 'x'.repeat(MESSAGE_MAX_LEN) }).success).toBe(true);
    expect(schema.safeParse({ content: 'x'.repeat(MESSAGE_MAX_LEN + 1) }).success).toBe(false);
    expect(schema.safeParse({ content: 42 }).success).toBe(false);
  });

  it('keeps inner newlines and HTML verbatim', () => {
    const content = 'line1\nline2 <b>x</b>';
    expect(sendMessageSchema.parse({ content }).content).toBe(content);
  });
});

describe('D5: lengths count code points', () => {
  it('textLength counts emoji and astral characters as one', () => {
    expect(textLength('abc')).toBe(3);
    expect(textLength('😀')).toBe(1);
    expect('😀'.length).toBe(2);
    expect(textLength('a😀b𝄞')).toBe(4);
    expect(textLength('')).toBe(0);
  });

  it('accepts 2000 emoji, rejects 2001', () => {
    expect(sendMessageSchema.safeParse({ content: '😀'.repeat(MESSAGE_MAX_LEN) }).success).toBe(
      true,
    );
    expect(sendMessageSchema.safeParse({ content: '😀'.repeat(MESSAGE_MAX_LEN + 1) }).success).toBe(
      false,
    );
  });

  it('guild names count code points too', () => {
    expect(createGuildSchema.safeParse({ name: '😀'.repeat(GUILD_NAME_MAX_LEN) }).success).toBe(
      true,
    );
    expect(createGuildSchema.safeParse({ name: '😀'.repeat(GUILD_NAME_MAX_LEN + 1) }).success).toBe(
      false,
    );
  });
});

describe('D3: control characters', () => {
  it.each([sendMessageSchema, editMessageSchema])(
    'message content rejects NUL and other control chars',
    (schema) => {
      for (const c of ['\u0000', '\u0001', '\u0008', '\u000b', '\u000c', '\u001b', '\u007f']) {
        expect(schema.safeParse({ content: `a${c}b` }).success, JSON.stringify(c)).toBe(false);
      }
    },
  );

  it('message content keeps tab, newline and CR', () => {
    expect(sendMessageSchema.parse({ content: 'a\tb\nc\r\nd' }).content).toBe('a\tb\nc\r\nd');
  });

  it('guild names reject any control char', () => {
    for (const c of ['\u0000', '\t', '\n', '\u001f', '\u007f', '\u0085', '\u009f']) {
      expect(createGuildSchema.safeParse({ name: `a${c}b` }).success, JSON.stringify(c)).toBe(
        false,
      );
    }
    expect(createGuildSchema.parse({ name: ' Mein Server ' }).name).toBe('Mein Server');
  });

  it('channel names and usernames reject control chars', () => {
    expect(createChannelSchema.safeParse({ name: 'a\u0000b' }).success).toBe(false);
    expect(createChannelSchema.safeParse({ name: 'a\u007fb' }).success).toBe(false);
    const base = { email: 'a@example.com', password: 'Tr0ckenBlume!' };
    expect(registerSchema.safeParse({ ...base, username: 'ab\u0000c' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...base, username: 'abc\n' }).success).toBe(true); // trimmed
    expect(registerSchema.safeParse({ ...base, username: 'ab\u0001c' }).success).toBe(false);
  });
});

describe('listMessagesQuery', () => {
  it('defaults limit to 50', () => {
    expect(listMessagesQuery.parse({})).toEqual({ limit: PAGE_DEFAULT });
  });

  it('coerces limit and validates range', () => {
    expect(listMessagesQuery.parse({ limit: '10' }).limit).toBe(10);
    expect(listMessagesQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(listMessagesQuery.safeParse({ limit: '101' }).success).toBe(false);
    expect(listMessagesQuery.safeParse({ limit: 'abc' }).success).toBe(false);
  });

  it('validates before as positive integer string', () => {
    expect(listMessagesQuery.parse({ before: '123' }).before).toBe('123');
    expect(listMessagesQuery.safeParse({ before: '0' }).success).toBe(false);
    expect(listMessagesQuery.safeParse({ before: '-1' }).success).toBe(false);
    expect(listMessagesQuery.safeParse({ before: 'x' }).success).toBe(false);
  });
});

describe('inviteCodeSchema', () => {
  it('accepts base62 codes and rejects others', () => {
    expect(inviteCodeSchema.safeParse('aB3dE5gH9k').success).toBe(true);
    expect(inviteCodeSchema.safeParse('bad code').success).toBe(false);
    expect(inviteCodeSchema.safeParse('../etc').success).toBe(false);
    expect(inviteCodeSchema.safeParse('x'.repeat(17)).success).toBe(false);
  });
});

describe('wsClientMessageSchema', () => {
  const channelId = '3f1c2a4e-8b7d-4c1a-9e2f-123456789abc';

  it('parses subscribe/unsubscribe/ping', () => {
    expect(wsClientMessageSchema.parse({ type: 'subscribe', data: { channelId } }).type).toBe(
      'subscribe',
    );
    expect(wsClientMessageSchema.parse({ type: 'unsubscribe', data: { channelId } }).type).toBe(
      'unsubscribe',
    );
    expect(wsClientMessageSchema.parse({ type: 'ping' }).type).toBe('ping');
  });

  it('rejects unknown types and bad channel ids', () => {
    expect(wsClientMessageSchema.safeParse({ type: 'send', data: {} }).success).toBe(false);
    expect(
      wsClientMessageSchema.safeParse({ type: 'subscribe', data: { channelId: 'nope' } }).success,
    ).toBe(false);
  });
});

describe('messageIdSchema', () => {
  it('rejects ids beyond the bigint range', () => {
    expect(listMessagesQuery.safeParse({ before: '9223372036854775807' }).success).toBe(true);
    expect(listMessagesQuery.safeParse({ before: '9223372036854775808' }).success).toBe(false);
  });
});

describe('messageIdSchema robustness', () => {
  it('rejects non-numeric ids without throwing', () => {
    expect(() => listMessagesQuery.safeParse({ before: 'abc' })).not.toThrow();
    expect(listMessagesQuery.safeParse({ before: 'abc' }).success).toBe(false);
  });
});
