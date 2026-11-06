import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { ChannelSidebar } from '../components/ChannelSidebar';
import { ChatView } from '../components/ChatView';
import { DmView } from '../components/DmView';
import { FriendsView } from '../components/FriendsView';
import { HomeSidebar } from '../components/HomeSidebar';
import { IncomingCall } from '../components/IncomingCall';
import { QuickSwitcher } from '../components/QuickSwitcher';
import { ProfileSettings } from '../components/ProfileSettings';
import { ProfileDialog } from '../components/ProfileDialog';
import { useBadgeStore } from '../store/badges';
import { AdminSettings } from '../components/AdminSettings';
import { ConnectionBanner } from '../components/ConnectionBanner';
import { CreateGuildDialog } from '../components/CreateGuildDialog';
import { ErrorToast } from '../components/ErrorToast';
import { InstallBanner } from '../components/InstallBanner';
import { ScheduledSettings } from '../components/ScheduledSettings';
import { SecuritySettings } from '../components/SecuritySettings';
import { SettingsDialog } from '../components/SettingsDialog';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { SpeechSettings } from '../components/SpeechSettings';
import { VoiceSettings } from '../components/VoiceSettings';
import { VoiceChannelView } from '../components/VoiceChannelView';
import { loadVoiceState } from '../voice/voiceState';
import { Icon } from '../components/Icon';
import { MemberList } from '../components/MemberList';
import { MessageSkeleton } from '../components/Skeleton';
import { ServerList } from '../components/ServerList';
import { activeView, loadGuildRoles } from '../realtime/RealtimeProvider';
import { useChatStore } from '../store/chat';
import { usePrefs } from '../store/prefs';

/** ServerList | ChannelSidebar | ChatView | MemberList; on mobile the first two form a drawer. */
export function AppLayout() {
  const { guildId = null, channelId = null } = useParams();
  const location = useLocation();
  /** Friends and private conversations (/me, /me/:channelId). */
  const home = location.pathname === '/me' || location.pathname.startsWith('/me/');
  const dms = useChatStore((s) => s.dms);
  const dmsLoaded = useChatStore((s) => s.dmsLoaded);
  const dm = home && channelId ? (dms.find((d) => d.channel.id === channelId) ?? null) : null;
  const guilds = useChatStore((s) => s.guilds);
  const guildsLoaded = useChatStore((s) => s.guildsLoaded);
  const channels = useChatStore((s) => (guildId ? s.channelsByGuild[guildId] : undefined));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [creatingGuild, setCreatingGuild] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const showMembers = usePrefs((s) => s.showMembers);
  const navigate = useNavigate();
  const [switcherOpen, setSwitcherOpen] = useState(false);

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

  useEffect(() => {
    void useBadgeStore.getState().load();
  }, []);

  // Friends and private conversations (once per session; refreshed on reconnect).
  useEffect(() => {
    const chat = useChatStore.getState();
    if (!chat.friendsLoaded) {
      api.listFriends().then(
        (r) => useChatStore.getState().setFriends(r.friends),
        () => useChatStore.getState().setFriends([]),
      );
    }
    if (!chat.dmsLoaded) {
      api.listDms().then(
        (r) => useChatStore.getState().setDms(r.dms),
        () => useChatStore.getState().setDms([]),
      );
    }
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
    void loadGuildRoles(guildId);
    api.listCategories(guildId).then(
      (r) => useChatStore.getState().setCategories(guildId, r.categories),
      () => undefined,
    );
  }, [guildId, guildKnown]);

  // Who is in the guild's voice channels (kept current by voice.state events afterwards).
  const voiceChannelIds = channels
    ?.filter((c) => c.kind === 'voice')
    .map((c) => c.id)
    .join(',');
  useEffect(() => {
    if (!guildId || !voiceChannelIds) return;
    loadVoiceState(guildId, voiceChannelIds.split(',')).catch(() => undefined);
  }, [guildId, voiceChannelIds]);

  useEffect(() => {
    activeView.guildId = guild ? guildId : null;
    activeView.channelId = channel || dm ? channelId : null;
    return () => {
      activeView.guildId = null;
      activeView.channelId = null;
    };
  }, [guild, guildId, channel, dm, channelId]);

  // Alt+↑/↓: previous or next channel or conversation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const paths = home
        ? dms.map((d) => `/me/${d.channel.id}`)
        : (channels ?? []).map((c) => `/guilds/${guildId}/channels/${c.id}`);
      if (paths.length === 0) return;
      e.preventDefault();
      const at = paths.indexOf(location.pathname);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = paths[at === -1 ? 0 : (at + step + paths.length) % paths.length];
      if (next) navigate(next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [home, dms, channels, guildId, location.pathname, navigate]);

  // Strg+K: jump by name.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSwitcherOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Redirects: "/" → first guild; unknown guild → "/"; guild without channel → first channel;
  // unknown private conversation → friends.
  if (home) {
    if (channelId && dmsLoaded && !dm) return <Navigate to="/me" replace />;
  } else if (!guildId) {
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
    <div className={`app-layout${guild && showMembers && !home ? ' has-guild' : ''}`}>
      <div className={`nav-drawer${drawerOpen ? ' open' : ''}`} data-testid="mobile-drawer">
        <ServerList activeGuildId={home ? null : guildId} home={home} />
        {home ? (
          <HomeSidebar
            activeChannelId={dm ? channelId : null}
            onNavigate={() => setDrawerOpen(false)}
            onOpenSettings={() => {
              setDrawerOpen(false);
              setSettingsOpen(true);
            }}
          />
        ) : (
          <ChannelSidebar
            guild={guild}
            activeChannelId={channelId}
            onNavigate={() => setDrawerOpen(false)}
            onOpenSettings={() => {
              setDrawerOpen(false);
              setSettingsOpen(true);
            }}
          />
        )}
      </div>
      {drawerOpen && (
        <div
          className="drawer-backdrop"
          data-testid="drawer-backdrop"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main className="main-pane">
        {home ? (
          dm ? (
            <DmView key={dm.channel.id} dm={dm} onOpenMenu={() => setDrawerOpen(true)} />
          ) : channelId ? (
            <MessageSkeleton />
          ) : (
            <FriendsView onOpenMenu={() => setDrawerOpen(true)} />
          )
        ) : channel?.kind === 'voice' ? (
          <VoiceChannelView channel={channel} onOpenMenu={() => setDrawerOpen(true)} />
        ) : channel ? (
          <ChatView
            channel={channel}
            onOpenMenu={() => setDrawerOpen(true)}
            membersOpen={showMembers}
            onToggleMembers={() => usePrefs.getState().set({ showMembers: !showMembers })}
          />
        ) : (
          <section className="chat-view">
            <header className="chat-header">
              <button
                className="icon-btn mobile-only"
                data-testid="mobile-menu-button"
                aria-label="Menü öffnen"
                onClick={() => setDrawerOpen(true)}
              >
                <Icon name="menu" />
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
              <MessageSkeleton />
            )}
          </section>
        )}
      </main>

      {guild && showMembers && !home && <MemberList guildId={guild.id} />}
      {switcherOpen && <QuickSwitcher onClose={() => setSwitcherOpen(false)} />}
      <IncomingCall />
      <ProfileDialog onEditOwn={() => setSettingsOpen(true)} />
      {creatingGuild && <CreateGuildDialog onClose={() => setCreatingGuild(false)} />}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          extra={
            <>
              <ProfileSettings />
              <AdminSettings />
              <ScheduledSettings />
              <SecuritySettings />
              <AppearanceSettings />
              <SpeechSettings />
              <VoiceSettings />
            </>
          }
        />
      )}
      <InstallBanner onShowGuide={() => setSettingsOpen(true)} />
      <ErrorToast />
    </div>
  );
}
