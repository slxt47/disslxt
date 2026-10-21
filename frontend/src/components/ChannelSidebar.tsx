import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GuildDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { CreateChannelDialog } from './CreateChannelDialog';

export interface ChannelSidebarProps {
  guild: GuildDto | null;
  activeChannelId: string | null;
  onNavigate: () => void;
}

export function inviteUrl(code: string): string {
  return `${window.location.origin}/invite/${code}`;
}

export function ChannelSidebar({ guild, activeChannelId, onNavigate }: ChannelSidebarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const channels = useChatStore((s) => (guild ? s.channelsByGuild[guild.id] : undefined));
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = !!guild && guild.ownerId === user?.id;

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

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="channel-sidebar">
      {guild ? (
        <>
          <header className="sidebar-header">
            <h2 className="guild-name" data-testid="guild-name" title={guild.name}>
              {guild.name}
            </h2>
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
                  +
                </button>
              )}
            </div>
            <ul className="channels" data-testid="channel-list">
              {channels?.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/guilds/${guild.id}/channels/${c.id}`}
                    className={`channel-link${c.id === activeChannelId ? ' active' : ''}`}
                    data-testid={`channel-item-${c.name}`}
                    aria-current={c.id === activeChannelId ? 'page' : undefined}
                    onClick={onNavigate}
                  >
                    <span aria-hidden="true">#</span> {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="sidebar-section invite">
            <h3 className="sidebar-heading">Einladungslink</h3>
            <code className="invite-link" data-testid="invite-link">
              {inviteUrl(guild.inviteCode)}
            </code>
            <button
              className="btn small"
              data-testid="copy-invite-button"
              onClick={() => void copyInvite(guild.inviteCode)}
            >
              {copied ? 'Kopiert!' : 'Link kopieren'}
            </button>
          </div>
          {!isOwner && (
            <div className="sidebar-section">
              {confirmLeave ? (
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
                  className="btn small danger-outline"
                  data-testid="leave-guild-button"
                  onClick={() => setConfirmLeave(true)}
                >
                  Server verlassen
                </button>
              )}
            </div>
          )}
          {creating && (
            <CreateChannelDialog guildId={guild.id} onClose={() => setCreating(false)} />
          )}
        </>
      ) : (
        <header className="sidebar-header">
          <h2 className="guild-name">disslxt</h2>
        </header>
      )}
      <footer className="user-footer">
        <span className="current-user" data-testid="current-user">
          {user?.username}
        </span>
        <button className="btn small" data-testid="logout-button" onClick={() => void onLogout()}>
          Abmelden
        </button>
      </footer>
    </div>
  );
}
