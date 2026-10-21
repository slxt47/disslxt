import { useEffect, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { ChatView } from '../components/ChatView';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { CreateGuildDialog } from '../components/CreateGuildDialog';
import { ErrorToast } from '../components/ErrorToast';
import { MemberList } from '../components/MemberList';
import { ServerList } from '../components/ServerList';
import { activeView } from '../realtime/RealtimeProvider';
import { useChatStore } from '../store/chat';

/** ServerList | ChannelSidebar | ChatView | MemberList; on mobile the first two form a drawer. */
export function AppLayout() {
  const { guildId = null, channelId = null } = useParams();
  const location = useLocation();
  const guilds = useChatStore((s) => s.guilds);
  const guildsLoaded = useChatStore((s) => s.guildsLoaded);
  const channels = useChatStore((s) => (guildId ? s.channelsByGuild[guildId] : undefined));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creatingGuild, setCreatingGuild] = useState(false);

  const guild = guildId ? (guilds.find((g) => g.id === guildId) ?? null) : null;
  const channel = channelId ? (channels?.find((c) => c.id === channelId) ?? null) : null;

  // Guild list (once per session; refreshed on reconnect).
  useEffect(() => {
    if (useChatStore.getState().guildsLoaded) return;
    api.listGuilds().then(
      (r) => useChatStore.getState().setGuilds(r.guilds),
      (err: unknown) => {
        useChatStore.getState().setError(errorMessage(err));
        useChatStore.getState().setGuilds([]);
      },
    );
  }, []);

  // Channels + members of the active guild.
  const guildKnown = !!guild;
  useEffect(() => {
    if (!guildId || !guildKnown) return;
    const chat = useChatStore.getState();
    api.listChannels(guildId).then(
      (r) => useChatStore.getState().setChannels(guildId, r.channels),
      (err: unknown) => chat.setError(errorMessage(err)),
    );
    api.listMembers(guildId).then(
      (r) => useChatStore.getState().setMembers(guildId, r.members),
      (err: unknown) => chat.setError(errorMessage(err)),
    );
  }, [guildId, guildKnown]);

  useEffect(() => {
    activeView.guildId = guild ? guildId : null;
    activeView.channelId = channel ? channelId : null;
    return () => {
      activeView.guildId = null;
      activeView.channelId = null;
    };
  }, [guild, guildId, channel, channelId]);

  // Picking a channel (or any navigation) closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  if (!guildsLoaded) {
    return (
      <div className="center-page" data-testid="loading">
        Lädt…
      </div>
    );
  }

  // Redirects: "/" → first guild; unknown guild → "/"; guild without channel → first channel.
  if (!guildId) {
    const first = guilds[0];
    if (first) return <Navigate to={`/guilds/${first.id}`} replace />;
  } else if (!guild) {
    return <Navigate to="/" replace />;
  } else if (channels) {
    const first = channels[0];
    if (!channelId && first)
      return <Navigate to={`/guilds/${guildId}/channels/${first.id}`} replace />;
    if (channelId && !channel) {
      return <Navigate to={first ? `/guilds/${guildId}/channels/${first.id}` : '/'} replace />;
    }
  }

  return (
    <div className={`app-layout${guild ? ' has-guild' : ''}`}>
      <div className={`nav-drawer${drawerOpen ? ' open' : ''}`} data-testid="mobile-drawer">
        <ServerList activeGuildId={guildId} />
        <ChannelSidebar
          guild={guild}
          activeChannelId={channelId}
          onNavigate={() => setDrawerOpen(false)}
        />
      </div>
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          data-testid="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="main-pane">
        {channel ? (
          <ChatView channel={channel} onOpenMenu={() => setDrawerOpen(true)} />
        ) : (
          <section className="chat-view">
            <header className="chat-header">
              <button
                className="icon-btn mobile-only"
                data-testid="mobile-menu-button"
                aria-label="Menü öffnen"
                onClick={() => setDrawerOpen(true)}
              >
                ☰
              </button>
              <h1 className="chat-title">{guild ? guild.name : 'disslxt'}</h1>
            </header>
            <ConnectionBanner />
            {guilds.length === 0 ? (
              <div className="empty-state" data-testid="empty-state">
                <h2>Willkommen!</h2>
                <p>
                  Du bist noch in keinem Server. Erstelle einen oder nutze einen Einladungslink.
                </p>
                <button
                  className="btn primary"
                  data-testid="empty-create-guild"
                  onClick={() => setCreatingGuild(true)}
                >
                  Server erstellen
                </button>
              </div>
            ) : (
              <div className="empty-state muted">Lädt…</div>
            )}
          </section>
        )}
      </main>

      {guild && <MemberList guildId={guild.id} />}
      {creatingGuild && <CreateGuildDialog onClose={() => setCreatingGuild(false)} />}
      <ErrorToast />
    </div>
  );
}
