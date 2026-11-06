import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWhen, runCommand } from '../lib/commands';
import { clearDrafts, loadDraft, saveDraft } from '../lib/drafts';
import { ALL_EMOJI, emojiForCode, replaceShortcodes, searchEmoji } from '../lib/emoji';
import { mentionsUser, renderMarkdown } from '../lib/markdown';
import { groupChannels, moveChannel } from '../components/ChannelOrganizer';
import { activeToken, Composer } from '../components/Composer';
import { rankTargets } from '../components/QuickSwitcher';
import { MessageItem } from '../components/MessageItem';
import { inviteStatus } from '../components/InviteSettings';
import { layoutMessages } from '../components/MessageList';
import { useChatStore } from '../store/chat';
import { typingText, useTypingStore } from '../store/typing';
import { CHANNEL, ME, msg, OTHER } from './fixtures';

const html = (text: string, self: string | null = null) =>
  render(<div data-testid="md">{renderMarkdown(text, self)}</div>).getByTestId('md').innerHTML;

describe('markdown', () => {
  it.each([
    ['**fett**', '<strong>fett</strong>'],
    ['*kursiv*', '<em>kursiv</em>'],
    ['_kursiv_', '<em>kursiv</em>'],
    ['~~weg~~', '<s>weg</s>'],
    ['`a*b*`', '<code>a*b*</code>'],
    ['**fett und *kursiv***', '<strong>fett und <em>kursiv</em></strong>'],
  ])('%s', (input, out) => expect(html(input)).toBe(out));

  it.each(['snake_case_name', '2 * 3 * 4', '**', '* a *', 'a_b', '5*3=15', 'kein `code'])(
    'leaves %s alone',
    (input) => {
      const el = render(<div data-testid="p">{renderMarkdown(input)}</div>).getByTestId('p');
      expect(el.children).toHaveLength(0);
      expect(el.textContent).toBe(input);
    },
  );

  it('never produces HTML from text', () => {
    const el = render(
      <div data-testid="x">{renderMarkdown('<img src=x onerror=alert(1)> **<b>x</b>**')}</div>,
    ).getByTestId('x');
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<img src=x');
  });

  it('makes http(s) links, without the punctuation after them', () => {
    const el = render(
      <div data-testid="l">
        {renderMarkdown('Siehe https://example.com/a_b?x=1. Und (http://a.de)')}
      </div>,
    ).getByTestId('l');
    const links = [...el.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://example.com/a_b?x=1',
      'http://a.de/',
    ]);
    expect(links[0]?.getAttribute('rel')).toContain('noopener');
    expect(links[0]?.target).toBe('_blank');
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.de/a'])('no link for %s', (t) => {
    const el = render(<div data-testid="n">{renderMarkdown(t)}</div>).getByTestId('n');
    expect(el.querySelector('a')).toBeNull();
  });

  it('code blocks keep their text, language line is dropped', () => {
    const el = render(
      <div data-testid="c">{renderMarkdown('vor\n```js\nconst a = **1**;\n```\nnach')}</div>,
    ).getByTestId('c');
    expect(el.querySelector('pre code')?.textContent).toBe('const a = **1**;');
    expect(el.querySelector('strong')).toBeNull();
    expect(el.textContent).toContain('nach');
  });

  it('marks mentions, own ones specially; mail addresses are none', () => {
    const out = html('@alice und @bob und a@bob.de', 'bob');
    expect(out).toContain('<span class="mention">@alice</span>');
    expect(out).toContain('<span class="mention me">@bob</span>');
    expect(out).toContain('a@bob.de');
  });

  it('finds mentions outside of code only', () => {
    expect(mentionsUser('hey @Bob!', 'bob')).toBe(true);
    expect(mentionsUser('hey @bobby', 'bob')).toBe(false);
    expect(mentionsUser('`@bob`', 'bob')).toBe(false);
    expect(mentionsUser('```\n@bob\n```', 'bob')).toBe(false);
  });

  it('backslash shows the character itself', () => {
    const el = render(<div data-testid="e">{renderMarkdown('¯\\\\\\_(ツ)\\_/¯')}</div>).getByTestId(
      'e',
    );
    expect(el.textContent).toBe('¯\\_(ツ)_/¯');
  });
});

describe('slash commands', () => {
  it('leaves normal text alone', () => {
    expect(runCommand('hallo')).toBeNull();
    expect(runCommand('/etc/passwd ist eine Datei')).toBeNull();
    expect(runCommand('/unbekannt')).toBeNull();
  });
  it('sends a leading slash with //', () => {
    expect(runCommand('//shrug')).toEqual({ text: '/shrug' });
  });
  it('shrug shows up right after formatting', () => {
    const r = runCommand('/shrug naja');
    const text = r && 'text' in r ? r.text : '';
    const el = render(<div data-testid="s">{renderMarkdown(text)}</div>).getByTestId('s');
    expect(el.textContent).toBe('naja ¯\\_(ツ)_/¯');
  });
  it('rolls within the range and refuses nonsense', () => {
    expect(runCommand('/würfeln', () => 4)).toEqual({
      text: '🎲 hat eine **4** gewürfelt (1–6)',
    });
    expect(runCommand('/würfeln 20', () => 20)).toEqual({
      text: '🎲 hat eine **20** gewürfelt (1–20)',
    });
    expect(runCommand('/würfeln 1')).toHaveProperty('error');
    expect(runCommand('/würfeln abc')).toHaveProperty('error');
  });
  it('real randomness stays in range', () => {
    for (let i = 0; i < 200; i += 1) {
      const r = runCommand('/würfeln 3');
      const n = Number(/\*\*(\d+)\*\*/.exec(r && 'text' in r ? r.text : '')?.[1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
  it('me needs text', () => {
    expect(runCommand('/me winkt')).toEqual({ text: '*winkt*' });
    expect(runCommand('/me')).toHaveProperty('error');
  });
});

describe('emoji', () => {
  it('knows codes and finds German words', () => {
    expect(emojiForCode('thumbsup')).toBe('👍');
    expect(emojiForCode('gibtsnicht')).toBeNull();
    expect(searchEmoji('katze')[0]?.emoji).toBe('🐱');
  });
  it('replaces :codes: but not in code or unknown ones', () => {
    expect(replaceShortcodes('super :thumbsup: :nope: `:thumbsup:`')).toBe(
      'super 👍 :nope: `:thumbsup:`',
    );
  });
  it('has no duplicate emoji (React keys) and valid codes', () => {
    const codes = ALL_EMOJI.map((e) => e.code);
    const emoji = ALL_EMOJI.map((e) => e.emoji);
    expect(codes.filter((c, i) => codes.indexOf(c) !== i)).toEqual([]);
    expect(emoji.filter((c, i) => emoji.indexOf(c) !== i)).toEqual([]);
    expect(codes.every(Boolean)).toBe(true);
  });
});

describe('composer', () => {
  beforeEach(() => {
    localStorage.clear();
    clearDrafts();
  });

  const setup = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<Composer channelName="general" onSend={onSend} {...props} />);
    const input = screen.getByTestId<HTMLTextAreaElement>('composer-input');
    const type = (value: string) =>
      fireEvent.change(input, { target: { value, selectionStart: value.length } });
    return { onSend, input, type };
  };

  it('finds the word being typed', () => {
    expect(activeToken('hallo @an', 9)).toEqual({ kind: '@', query: 'an', start: 6 });
    expect(activeToken('/wü', 3)).toEqual({ kind: '/', query: 'wü', start: 0 });
    expect(activeToken('es ist 10:30', 12)).toBeNull();
    expect(activeToken('a :s', 4)).toBeNull();
    expect(activeToken('a :sm', 5)).toEqual({ kind: ':', query: 'sm', start: 2 });
    expect(activeToken('mail@bob', 8)).toBeNull();
  });

  it('suggests people and completes with Enter', () => {
    const { input, type, onSend } = setup({
      people: [{ username: 'bob_x', displayName: 'Robert', avatarUrl: null }],
    });
    type('hi @ro');
    expect(screen.getByTestId('suggestion-bob_x')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('hi @bob_x ');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter sends when the name is already complete', async () => {
    const { input, type, onSend } = setup({
      people: [{ username: 'bob_x', displayName: null, avatarUrl: null }],
    });
    type('frage @bob_x');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSend).toHaveBeenCalledWith('frage @bob_x');
  });

  it('a whole :code: becomes the emoji while typing', () => {
    const { input, type } = setup();
    type(':heart:');
    expect(input.value).toBe('❤️');
  });

  it('runs commands on send', async () => {
    const { input, type, onSend } = setup();
    type('/me winkt');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSend).toHaveBeenCalledWith('*winkt*');
  });

  it('shows the error of a wrong command and sends nothing', async () => {
    const { input, type, onSend } = setup();
    type('/me');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-error').textContent).toContain('/me winkt');
  });

  it('keeps a draft per channel, and clears it when sent', async () => {
    const first = setup({ draftKey: CHANNEL });
    first.type('halb fertig');
    expect(loadDraft(CHANNEL)).toBe('halb fertig');
    await act(async () => {
      fireEvent.keyDown(first.input, { key: 'Enter' });
    });
    expect(loadDraft(CHANNEL)).toBe('');
    saveDraft('other', 'bleibt');
    clearDrafts();
    expect(loadDraft('other')).toBe('');
  });

  it('restores a draft', () => {
    saveDraft(CHANNEL, 'von vorhin');
    const { input } = setup({ draftKey: CHANNEL });
    expect(input.value).toBe('von vorhin');
  });

  it('↑ in the empty field edits the last message, not with text', () => {
    const onEditLast = vi.fn();
    const { input, type } = setup({ onEditLast });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onEditLast).toHaveBeenCalledTimes(1);
    type('x');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onEditLast).toHaveBeenCalledTimes(1);
  });

  it('shows the answered message; Escape cancels', () => {
    const onCancelReply = vi.fn();
    const { input } = setup({ replyTo: msg(5, { content: 'die Frage' }), onCancelReply });
    expect(screen.getByTestId('composer-reply').textContent).toContain('die Frage');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancelReply).toHaveBeenCalled();
  });

  it('tells about typing at most every few seconds, not for commands', () => {
    const onTyping = vi.fn();
    const { type } = setup({ onTyping });
    type('/sh');
    expect(onTyping).not.toHaveBeenCalled();
    type('a');
    type('ab');
    type('abc');
    expect(onTyping).toHaveBeenCalledTimes(1);
  });
});

describe('message', () => {
  const item = (props: Partial<Parameters<typeof MessageItem>[0]>) =>
    render(
      <MessageItem
        message={msg(1)}
        isOwn={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        selfId={ME.id}
        selfName={ME.username}
        {...props}
      />,
    );

  it('shows reactions, marks your own, a click toggles', () => {
    const onReact = vi.fn().mockResolvedValue(undefined);
    item({
      onReact,
      message: msg(1, {
        reactions: [
          { emoji: '👍', count: 2, userIds: [ME.id, OTHER.id] },
          { emoji: '🎉', count: 1, userIds: [OTHER.id] },
        ],
      }),
    });
    const own = screen.getByTestId('reaction-👍');
    expect(own.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('reaction-🎉').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(own);
    expect(onReact).toHaveBeenCalledWith('1', '👍');
  });

  it('shows what it answers and jumps there', () => {
    const onJump = vi.fn();
    item({
      onJump,
      message: msg(2, {
        replyTo: { id: '1', author: ME, kind: 'text', excerpt: 'die Frage' },
      }),
    });
    fireEvent.click(screen.getByTestId('message-reply'));
    expect(onJump).toHaveBeenCalledWith('1');
  });

  it('lights up when it mentions or answers you, not your own', () => {
    const { container, unmount } = item({ message: msg(1, { content: 'hey @alice' }) });
    expect(container.querySelector('.mentions-me')).not.toBeNull();
    unmount();
    const own = item({ isOwn: true, message: msg(1, { content: 'hey @alice' }) });
    expect(own.container.querySelector('.mentions-me')).toBeNull();
    own.unmount();
    const answer = item({
      message: msg(2, { replyTo: { id: '1', author: ME, kind: 'file', excerpt: '' } }),
    });
    expect(answer.container.querySelector('.mentions-me')).not.toBeNull();
  });

  it('pin button only with the right to pin', () => {
    const { unmount } = item({});
    expect(screen.queryByTestId('message-pin')).toBeNull();
    unmount();
    item({ onPin: vi.fn().mockResolvedValue(undefined), message: msg(1, { pinnedAt: 'x' }) });
    expect(screen.getByTestId('message-pin').getAttribute('aria-label')).toBe('Lösen');
    expect(screen.getByTestId('message-pinned')).toBeTruthy();
  });

  it('a greeting has no actions and the same text for everyone', () => {
    const m = msg(7, { kind: 'join', content: '' });
    item({ message: m, onReact: vi.fn(), onReply: vi.fn() });
    expect(screen.getByTestId('join-line').textContent).toContain('bob');
    expect(screen.queryByTestId('message-react')).toBeNull();
  });

  it('opens for editing when asked', () => {
    const onEditHandled = vi.fn();
    item({ isOwn: true, editRequested: true, onEditHandled });
    expect(screen.getByTestId('message-edit-input')).toBeTruthy();
    expect(onEditHandled).toHaveBeenCalled();
  });

  it('does not group greetings or answers', () => {
    const at = { createdAt: '2026-10-20T12:00:00.000Z' };
    const layout = layoutMessages([
      msg(1, at),
      msg(2, at),
      msg(3, { ...at, replyTo: { id: '1', author: OTHER, kind: 'text', excerpt: 'x' } }),
      msg(4, { ...at, kind: 'join', content: '' }),
      msg(5, at),
    ]);
    expect(layout.map((l) => l.grouped)).toEqual([false, true, false, false, false]);
  });
});

describe('unread store', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('counts, keeps mentions apart and clears', () => {
    const s = useChatStore.getState();
    s.countUnread('c', 'g', '5', false);
    s.countUnread('c', 'g', '6', true);
    expect(useChatStore.getState().unread.c).toMatchObject({ count: 2, mentions: 1, guildId: 'g' });
    s.clearUnread('c');
    expect(useChatStore.getState().unread.c).toBeUndefined();
  });

  it('a read on another device does not swallow newer messages', () => {
    const s = useChatStore.getState();
    s.countUnread('c', null, '10', false);
    s.clearUnread('c', '9');
    expect(useChatStore.getState().unread.c).toBeDefined();
    s.clearUnread('c', '10');
    expect(useChatStore.getState().unread.c).toBeUndefined();
  });

  it('a deleted message leaves its answers without the quote', () => {
    const s = useChatStore.getState();
    const answer = msg(2, { replyTo: { id: '1', author: OTHER, kind: 'text', excerpt: 'x' } });
    s.applyLatestPage(CHANNEL, [msg(1), answer], false);
    s.applyEvent({ type: 'message.deleted', data: { id: '1', channelId: CHANNEL } }, ME.id);
    expect(useChatStore.getState().messagesByChannel[CHANNEL]).toMatchObject([
      { id: '2', replyTo: null },
    ]);
  });

  it('reactions arrive live', () => {
    const s = useChatStore.getState();
    s.applyLatestPage(CHANNEL, [msg(1)], false);
    s.applyEvent(
      {
        type: 'message.reactions',
        data: {
          id: '1',
          channelId: CHANNEL,
          reactions: [{ emoji: '🔥', count: 1, userIds: [OTHER.id] }],
        },
      },
      ME.id,
    );
    expect(useChatStore.getState().messagesByChannel[CHANNEL]?.[0]?.reactions).toHaveLength(1);
  });
});

describe('typing', () => {
  it('words it by the number of people', () => {
    expect(typingText([])).toBe('');
    expect(typingText(['Anna'])).toBe('Anna schreibt gerade…');
    expect(typingText(['Anna', 'Bo'])).toBe('Anna und Bo schreiben gerade…');
    expect(typingText(['A', 'B', 'C'])).toBe('3 Personen schreiben gerade…');
  });
  it('goes away by itself', () => {
    vi.useFakeTimers();
    useTypingStore.getState().started('c', 'u', 'Anna');
    expect(useTypingStore.getState().byChannel.c).toEqual({ u: 'Anna' });
    vi.advanceTimersByTime(6000);
    expect(useTypingStore.getState().byChannel.c).toEqual({});
    vi.useRealTimers();
  });
});

describe('invite status', () => {
  const g = {
    inviteExpiresAt: null,
    inviteMaxUses: null,
    inviteUses: 0,
  } as Parameters<typeof inviteStatus>[0];
  it('tells what the link can do', () => {
    expect(inviteStatus(g)).toBe('läuft nicht ab, unbegrenzt nutzbar');
    expect(inviteStatus({ ...g, inviteMaxUses: 10, inviteUses: 2 })).toContain('2 von 10 genutzt');
    expect(inviteStatus({ ...g, inviteMaxUses: 2, inviteUses: 2 })).toBe('Link aufgebraucht');
    expect(inviteStatus({ ...g, inviteExpiresAt: '2020-01-01T00:00:00.000Z' })).toBe(
      'Link abgelaufen',
    );
  });
});

describe('roles', () => {
  beforeEach(() => useChatStore.getState().reset());

  it('tells you when you were removed from a server', () => {
    const s = useChatStore.getState();
    s.setGuilds([{ id: 'g' } as Parameters<typeof s.upsertGuild>[0]]);
    s.applyEvent(
      { type: 'member.left', data: { guildId: 'g', userId: ME.id, reason: 'banned' } },
      ME.id,
    );
    expect(useChatStore.getState().guilds).toEqual([]);
    expect(useChatStore.getState().error).toContain('gesperrt');
  });

  it('leaving yourself is no error', () => {
    const s = useChatStore.getState();
    s.setGuilds([{ id: 'g' } as Parameters<typeof s.upsertGuild>[0]]);
    s.applyEvent({ type: 'member.left', data: { guildId: 'g', userId: ME.id } }, ME.id);
    expect(useChatStore.getState().error).toBeNull();
  });

  it('delete button for moderators on foreign messages, without edit', () => {
    render(
      <MessageItem
        message={msg(1)}
        isOwn={false}
        canModerate
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('message-delete')).toBeTruthy();
    expect(screen.queryByTestId('message-edit')).toBeNull();
  });

  it('colours the name by role', () => {
    render(
      <MessageItem
        message={msg(1)}
        isOwn={false}
        authorColor="#ff0000"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('message-author').style.color).toBe('rgb(255, 0, 0)');
  });
});

describe('channel order', () => {
  const channel = (id: string, categoryId: string | null) =>
    ({ id, categoryId, name: id }) as Parameters<typeof groupChannels>[0][number];
  const cats = [{ id: 'c1', name: 'Eins', position: 0 }];

  it('groups by category; an unknown one counts as none', () => {
    const groups = groupChannels(
      [channel('a', null), channel('b', 'c1'), channel('x', 'weg')],
      cats,
    );
    expect(groups.map((g) => g.channels.map((c) => c.id))).toEqual([['a', 'x'], ['b']]);
  });

  it('moves within a group and into another', () => {
    const groups = groupChannels(
      [channel('a', null), channel('b', null), channel('c', 'c1')],
      cats,
    );
    const ids = (g: typeof groups) => g.map((x) => x.channels.map((c) => c.id));
    expect(ids(moveChannel(groups, 'b', null, 'a'))).toEqual([['b', 'a'], ['c']]);
    expect(ids(moveChannel(groups, 'a', null, null))).toEqual([['b', 'a'], ['c']]);
    expect(ids(moveChannel(groups, 'a', 'c1', 'c'))).toEqual([['b'], ['a', 'c']]);
    expect(ids(moveChannel(groups, 'a', 'c1', null))).toEqual([['b'], ['c', 'a']]);
  });
});

describe('link preview', () => {
  const linkPreview = {
    url: 'https://example.com/x',
    title: 'Titel',
    description: 'Text',
    siteName: 'Seite',
    imageUrl: '/api/link-images/a.png',
  };

  it('shows title and picture from here, opening the link safely', () => {
    render(
      <MessageItem
        message={msg(1, { linkPreview })}
        isOwn={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const card = screen.getByTestId('link-preview');
    expect(card.textContent).toContain('Titel');
    expect(card.querySelector('a')?.getAttribute('rel')).toContain('noopener');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/api/link-images/a.png');
    expect(screen.queryByTestId('link-preview-hide')).toBeNull();
  });

  it('the author can take it away', () => {
    render(
      <MessageItem message={msg(1, { linkPreview })} isOwn onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByTestId('link-preview-hide')).toBeTruthy();
  });
});

describe('voice transcript', () => {
  it('stands under the recording, only when there is one', () => {
    const audio = { url: '/x', durationMs: 1000, mime: 'audio/mp4' };
    const { unmount } = render(
      <MessageItem
        message={msg(1, { kind: 'voice', content: 'Hallo', audio })}
        isOwn={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByTestId('voice-transcript').textContent).toContain('Hallo');
    unmount();
    render(
      <MessageItem
        message={msg(1, { kind: 'voice', content: '', audio })}
        isOwn={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('voice-transcript')).toBeNull();
  });
});

describe('quick switcher ranking', () => {
  const list = [
    { label: 'off-topic', hint: 'Spiele' },
    { label: 'topic', hint: 'Spiele' },
    { label: 'stopper', hint: 'Sonst' },
    { label: 'anders', hint: 'Topics' },
    { label: 'nix', hint: 'nix' },
  ];
  it('start of name, word, anywhere, then the server', () => {
    expect(rankTargets(list, 'top').map((t) => t.label)).toEqual([
      'topic',
      'off-topic',
      'stopper',
      'anders',
    ]);
  });
  it('without a query everything stays in order', () => {
    expect(rankTargets(list, ' ')).toHaveLength(5);
  });
});

describe('poll command', () => {
  it('splits question and answers', () => {
    expect(runCommand('/umfrage Pizza? | Ja | Nein')).toEqual({
      poll: { question: 'Pizza?', options: ['Ja', 'Nein'] },
    });
  });
  it('needs two answers', () => {
    expect(runCommand('/umfrage Pizza? | Ja')).toHaveProperty('error');
    expect(runCommand('/umfrage')).toHaveProperty('error');
  });
});

describe('times in commands', () => {
  const now = new Date(2026, 10, 6, 14, 0);
  const at = (text: string) => parseWhen(text, now)?.at.getTime();

  it('understands spans', () => {
    expect(at('30m x')).toBe(now.getTime() + 30 * 60_000);
    expect(at('2h x')).toBe(now.getTime() + 2 * 3_600_000);
    expect(at('3d x')).toBe(now.getTime() + 3 * 86_400_000);
    expect(parseWhen('30m hallo welt', now)?.rest).toBe('hallo welt');
  });
  it('a time means today, or tomorrow if it has passed', () => {
    expect(at('20:00 x')).toBe(new Date(2026, 10, 6, 20, 0).getTime());
    expect(at('09:30 x')).toBe(new Date(2026, 10, 7, 9, 30).getTime());
  });
  it('dates, with and without year; a past one means next year', () => {
    expect(at('8.11. 20:00')).toBe(new Date(2026, 10, 8, 20, 0).getTime());
    expect(at('8.11.')).toBe(new Date(2026, 10, 8, 9, 0).getTime());
    expect(at('1.1. 10:00')).toBe(new Date(2027, 0, 1, 10, 0).getTime());
    expect(at('31.2. 10:00')).toBeUndefined();
  });
  it('nonsense is no time', () => {
    expect(parseWhen('morgen früh', now)).toBeNull();
    expect(parseWhen('25:00 x', now)).toBeNull();
  });
  it('commands say how they work', () => {
    expect(runCommand('/später Text')).toHaveProperty('error');
    expect(runCommand('/termin 8.11. 20:00 |')).toHaveProperty('error');
    expect(runCommand('/erinnern 1h Tee')).toMatchObject({
      schedule: { kind: 'remind', content: 'Tee' },
    });
    expect(runCommand('/termin 8.11. 20:00 | Spieleabend')).toMatchObject({
      event: { title: 'Spieleabend' },
    });
  });
});
