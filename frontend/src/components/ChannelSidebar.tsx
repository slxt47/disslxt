import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GuildDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { usePushStore } from '../store/push';
import { CreateChannelDialog } from './CreateChannelDialog';
import { DeleteGuildDialog } from './DeleteGuildDialog';
import { GuildSettingsDialog } from './GuildSettingsDialog';
import { Avatar, Icon } from './Icon';
import { UserFooter } from './UserFooter';
import { VoiceBar } from './VoiceBar';
import { useVoiceStore } from '../store/voice';
import { nameOf } from '../profile';

const NO_PEERS: never[] = [];

/** Who is in a voice channel, under its name in the list. */
function VoiceParticipants({ channelId }: { channelId: string }) {
  const peers = useVoiceStore((s) => s.participants[channelId] ?? NO_PEERS);
  if (peers.length === 0) return null;
  return (
    <ul className="voice-participants" data-testid={`voice-participants-${channelId}`}>
      {peers.map((p) => (
        <li key={p.peerId} data-testid={`voice-participant-${p.username}`}>
          <Avatar name={nameOf(p)} url={p.avatarUrl} size="sm" />
          <span>{nameOf(p)}</span>
          {p.muted && <Icon name="mic-off" size={14} />}
        </li>
      ))}
    </ul>
  );
}

export interface ChannelSidebarProps {
  guild: GuildDto | null;
  activeChannelId: string | null;
  onNavigate: () => void;
  onOpenSettings: () => void;
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/invite/${code}`;
}

export function ChannelSidebar({
  guild,
  activeChannelId,
  onNavigate,
  onOpenSettings,
}: ChannelSidebarProps) {
  const user = useAuthStore((s) => s.user);
  const channels = useChatStore((s) => (guild ? s.channelsByGuild[guild.id] : undefined));
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isOwner = !!guild && guild.ownerId === user?.id;
  const pushConfig = usePushStore((s) => s.config);
  const muted = !!guild && !!pushConfig?.mutedGuildIds.includes(guild.id);

  useEffect(() => {
    if (!usePushStore.getState().config)
      void usePushStore
        .getState()
        .load()
        .catch(() => undefined);
  }, []);

  // The server menu closes on a click outside, on Escape and when the server changes.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const guildId = guild?.id;
  useEffect(() => {
    setMenuOpen(false);
    setConfirmLeave(false);
  }, [guildId]);

  async function toggleMute(guildId: string) {
    try {
      await usePushStore.getState().setMuted(guildId, !muted);
    } catch (err) {
      useChatStore.getState().setError(errorMessage(err));
    }
  }

  async function copyInvite(code: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      useChatStore.getState().setError('Kopieren nicht möglich – bitte den Link manuell kopieren');
    }
  }

  async function leave(guildId: string) {
    setBusy(true);
    try {
      await api.leaveGuild(guildId);
      useChatStore.getState().removeGuild(guildId);
      setConfirmLeave(false);
      onNavigate();
      navigate('/');
    } catch (err) {
      useChatStore.getState().setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="channel-sidebar">
      {guild ? (
        <>
          <header className="sidebar-header" ref={menuRef}>
            <button
              className={`guild-menu-button${menuOpen ? ' open' : ''}`}
              data-testid="guild-menu-button"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              title={guild.name}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="guild-name" data-testid="guild-name">
                {guild.name}
              </span>
              <Icon name="chevron-down" size={18} />
            </button>
            {pushConfig?.enabled && (
              <button
                className={`icon-btn${muted ? ' muted-on' : ''}`}
                data-testid="guild-mute-toggle"
                aria-pressed={muted}
                aria-label={muted ? 'Mitteilungen für diesen Server an' : 'Server stummschalten'}
                title={muted ? 'Stummgeschaltet – tippen zum Einschalten' : 'Server stummschalten'}
                onClick={() => void toggleMute(guild.id)}
              >
                <Icon name={muted ? 'bell-off' : 'bell'} size={18} />
              </button>
            )}
            {menuOpen && (
              <div className="guild-menu" data-testid="guild-menu">
                <div className="guild-menu-section invite">
                  <h3 className="sidebar-heading">
                    <Icon name="user-plus" size={16} />
                    Leute einladen
                  </h3>
                  <code className="invite-link" data-testid="invite-link">
                    {inviteUrl(guild.inviteCode)}
                  </code>
                  <button
                    className="btn small primary"
                    data-testid="copy-invite-button"
                    onClick={() => void copyInvite(guild.inviteCode)}
                  >
                    <Icon name={copied ? 'check' : 'copy'} size={16} />
                    {copied ? 'Kopiert!' : 'Link kopieren'}
                  </button>
                </div>
                <div className="guild-menu-section">
                  {!isOwner &&
                    (confirmLeave ? (
                      <div className="leave-confirm">
                        <span>Server wirklich verlassen?</span>
                        <button
                          className="btn small danger"
                          data-testid="leave-guild-confirm"
                          disabled={busy}
                          onClick={() => void leave(guild.id)}
                        >
                          Verlassen
                        </button>
                        <button className="btn small" onClick={() => setConfirmLeave(false)}>
                          Abbrechen
                        </button>
                      </div>
                    ) : (
                      <button
                        className="menu-item danger"
                        data-testid="leave-guild-button"
                        onClick={() => setConfirmLeave(true)}
                      >
                        <Icon name="door" size={18} />
                        Server verlassen
                      </button>
                    ))}
                  {isOwner && (
                    <>
                      <button
                        className="menu-item"
                        data-testid="guild-settings-button"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditing(true);
                        }}
                      >
                        <Icon name="gear" size={18} />
                        Server-Einstellungen
                      </button>
                      <button
                        className="menu-item danger"
                        data-testid="delete-guild-button"
                        onClick={() => {
                          setMenuOpen(false);
                          setDeleting(true);
                        }}
                      >
                        <Icon name="trash" size={18} />
                        Server löschen
                      </button>
                      <p className="settings-hint sidebar-note">
                        Als Besitzer:in kannst du den Server nicht verlassen, nur löschen.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </header>
          <div className="sidebar-section">
            <div className="sidebar-heading-row">
              <h3 className="sidebar-heading">Textkanäle</h3>
              {isOwner && (
                <button
                  className="icon-btn"
                  data-testid="create-channel-button"
                  aria-label="Kanal erstellen"
                  title="Kanal erstellen"
                  onClick={() => setCreating(true)}
                >
                  <Icon name="plus" size={18} />
                </button>
              )}
            </div>
            <ul className="channels" data-testid="channel-list">
              {channels
                ?.filter((c) => c.kind !== 'voice')
                .map((c) => (
                  <li key={c.id}>
                    <Link
                      to={`/guilds/${guild.id}/channels/${c.id}`}
                      className={`channel-link${c.id === activeChannelId ? ' active' : ''}`}
                      data-testid={`channel-item-${c.name}`}
                      aria-current={c.id === activeChannelId ? 'page' : undefined}
                      onClick={onNavigate}
                    >
                      <Icon name="hash" size={16} />
                      <span className="sr-only">#</span>
                      {c.name}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
          {channels?.some((c) => c.kind === 'voice') && (
            <div className="sidebar-section">
              <div className="sidebar-heading-row">
                <h3 className="sidebar-heading">Sprachkanäle</h3>
              </div>
              <ul className="channels" data-testid="voice-channel-list">
                {channels
                  .filter((c) => c.kind === 'voice')
                  .map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/guilds/${guild.id}/channels/${c.id}`}
                        className={`channel-link${c.id === activeChannelId ? ' active' : ''}`}
                        data-testid={`channel-item-${c.name}`}
                        aria-current={c.id === activeChannelId ? 'page' : undefined}
                        onClick={onNavigate}
                      >
                        <Icon name="speaker" size={16} />
                        {c.name}
                      </Link>
                      <VoiceParticipants channelId={c.id} />
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {deleting && <DeleteGuildDialog guild={guild} onClose={() => setDeleting(false)} />}
          {editing && <GuildSettingsDialog guild={guild} onClose={() => setEditing(false)} />}
          {creating && (
            <CreateChannelDialog guildId={guild.id} onClose={() => setCreating(false)} />
          )}
        </>
      ) : (
        <header className="sidebar-header">
          <h2 className="guild-name">disslxt</h2>
        </header>
      )}
      <VoiceBar onNavigate={onNavigate} />
      <UserFooter onOpenSettings={onOpenSettings} />
    </div>
  );
}
