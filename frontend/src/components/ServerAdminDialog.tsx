import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  GUILD_PERMISSIONS,
  type ChannelDto,
  type GuildBanDto,
  type GuildDto,
  type GuildPermission,
  type MemberDto,
  type RoleDto,
} from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { nameOf } from '../profile';
import { useAuthStore } from '../store/auth';
import { useChatStore } from '../store/chat';
import { ChannelOrganizer } from './ChannelOrganizer';
import { Avatar, Icon } from './Icon';
import { InviteSettings } from './InviteSettings';
import { Modal } from './Modal';

export const PERMISSION_LABELS: Record<GuildPermission, string> = {
  manage_channels: 'Kanäle anlegen und Zugriff festlegen',
  manage_messages: 'Nachrichten anderer löschen und anpinnen',
  manage_invites: 'Einladungslink ändern',
  kick_members: 'Mitglieder entfernen',
  ban_members: 'Mitglieder sperren',
};

const NO_ROLES: RoleDto[] = [];
const NO_MEMBERS: MemberDto[] = [];
const NO_CHANNELS: ChannelDto[] = [];

type Run = (action: () => Promise<unknown>) => Promise<void>;

/** Follows the click at once; the server's answer arrives a moment later and wins. */
function Check({
  checked,
  onChange,
  testId,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(checked);
  useEffect(() => setShown(checked), [checked]);
  return (
    <label className="check-row">
      <input
        type="checkbox"
        checked={shown}
        data-testid={testId}
        onChange={(e) => {
          setShown(e.target.checked);
          onChange(e.target.checked);
        }}
      />
      {children}
    </label>
  );
}

function RoleEditor({ guildId, role, run }: { guildId: string; role: RoleDto | null; run: Run }) {
  const [name, setName] = useState(role?.name ?? '');
  const [color, setColor] = useState<string | null>(role?.color ?? null);
  const [permissions, setPermissions] = useState<GuildPermission[]>(role?.permissions ?? []);

  function toggle(p: GuildPermission) {
    setPermissions((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]));
  }

  async function save() {
    const input = { name: name.trim(), color, permissions };
    await run(() =>
      role ? api.updateRole(guildId, role.id, input) : api.createRole(guildId, input),
    );
    if (!role) {
      setName('');
      setColor(null);
      setPermissions([]);
    }
  }

  return (
    <div className="role-editor" data-testid={role ? `role-${role.name}` : 'role-new'}>
      <div className="role-head">
        <input
          aria-label="Rollenname"
          placeholder="Neue Rolle, z. B. Moderation"
          value={name}
          maxLength={32}
          data-testid="role-name"
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          aria-label="Farbe"
          value={color ?? '#8b8ca2'}
          data-testid="role-color"
          onChange={(e) => setColor(e.target.value)}
        />
      </div>
      <div className="role-permissions">
        {GUILD_PERMISSIONS.map((p) => (
          <label key={p} className="check-row">
            <input
              type="checkbox"
              checked={permissions.includes(p)}
              data-testid={`perm-${p}`}
              onChange={() => toggle(p)}
            />
            {PERMISSION_LABELS[p]}
          </label>
        ))}
      </div>
      <div className="inline-actions">
        <button
          className="btn small primary"
          data-testid="role-save"
          disabled={!name.trim()}
          onClick={() => void save()}
        >
          {role ? 'Speichern' : 'Rolle anlegen'}
        </button>
        {role && (
          <button
            className="btn small danger-outline"
            data-testid="role-delete"
            onClick={() => void run(() => api.deleteRole(guildId, role.id))}
          >
            Löschen
          </button>
        )}
      </div>
    </div>
  );
}

function RolesTab({ guildId, roles, run }: { guildId: string; roles: RoleDto[]; run: Run }) {
  function move(index: number, by: number) {
    const ids = roles.map((r) => r.id);
    const [id] = ids.splice(index, 1);
    if (!id) return;
    ids.splice(index + by, 0, id);
    void run(() => api.orderRoles(guildId, ids));
  }
  return (
    <>
      <p className="settings-hint">
        Oben steht die höchste Rolle. Wer moderiert, kommt nur an Mitglieder unter der eigenen Rolle
        heran. Rollen vergeben kannst nur du.
      </p>
      {roles.map((role, i) => (
        <div key={`${role.id}:${role.name}:${role.permissions.join()}`} className="role-row">
          <div className="role-order">
            <button
              className="icon-btn"
              aria-label={`${role.name} höher`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              ↑
            </button>
            <button
              className="icon-btn"
              aria-label={`${role.name} tiefer`}
              disabled={i === roles.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
          </div>
          <RoleEditor guildId={guildId} role={role} run={run} />
        </div>
      ))}
      <RoleEditor guildId={guildId} role={null} run={run} />
    </>
  );
}

function MembersTab({
  guild,
  roles,
  isOwner,
  can,
  run,
}: {
  guild: GuildDto;
  roles: RoleDto[];
  isOwner: boolean;
  can: (p: GuildPermission) => boolean;
  run: Run;
}) {
  const members = useChatStore((s) => s.membersByGuild[guild.id] ?? NO_MEMBERS);
  const selfId = useAuthStore((s) => s.user?.id);
  const [confirm, setConfirm] = useState<{ userId: string; ban: boolean } | null>(null);

  return (
    <ul className="admin-members" data-testid="admin-members">
      {members.map((m) => {
        const others = m.userId !== selfId && m.userId !== guild.ownerId;
        const roleIds = m.roleIds ?? [];
        return (
          <li key={m.userId} data-testid={`admin-member-${m.username}`}>
            <div className="admin-member-head">
              <Avatar name={nameOf(m)} url={m.avatarUrl} size="sm" />
              <strong>{nameOf(m)}</strong>
              {m.userId === guild.ownerId && <span className="muted">Besitzer:in</span>}
              {others && can('kick_members') && (
                <button
                  className="btn small"
                  data-testid="member-kick"
                  onClick={() => setConfirm({ userId: m.userId, ban: false })}
                >
                  Entfernen
                </button>
              )}
              {others && can('ban_members') && (
                <button
                  className="btn small danger-outline"
                  data-testid="member-ban"
                  onClick={() => setConfirm({ userId: m.userId, ban: true })}
                >
                  Sperren
                </button>
              )}
            </div>
            {confirm?.userId === m.userId && (
              <div className="leave-confirm">
                <span>
                  {nameOf(m)} {confirm.ban ? 'sperren?' : 'entfernen?'}
                </span>
                <button
                  className="btn small danger"
                  data-testid="member-confirm"
                  onClick={() => {
                    setConfirm(null);
                    void run(() =>
                      confirm.ban
                        ? api.banMember(guild.id, m.userId)
                        : api.kickMember(guild.id, m.userId),
                    );
                  }}
                >
                  Ja
                </button>
                <button className="btn small" onClick={() => setConfirm(null)}>
                  Abbrechen
                </button>
              </div>
            )}
            {isOwner && m.userId !== guild.ownerId && roles.length > 0 && (
              <div className="role-chips">
                {roles.map((r) => (
                  <Check
                    key={r.id}
                    checked={roleIds.includes(r.id)}
                    testId={`member-role-${r.name}`}
                    onChange={(on) =>
                      void run(() =>
                        api.setMemberRoles(
                          guild.id,
                          m.userId,
                          on ? [...roleIds, r.id] : roleIds.filter((id) => id !== r.id),
                        ),
                      )
                    }
                  >
                    {r.name}
                  </Check>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ChannelAccess({
  channel,
  roles,
  run,
}: {
  channel: ChannelDto;
  roles: RoleDto[];
  run: Run;
}) {
  const [roleIds, setRoleIds] = useState<string[] | null>(null);
  const load = useCallback(() => {
    api.channelAccess(channel.id).then(
      (r) => setRoleIds(r.roleIds),
      () => setRoleIds([]),
    );
  }, [channel.id]);
  useEffect(load, [load]);

  const apply = (restricted: boolean, ids: string[]) => {
    setRoleIds(ids);
    void run(() => api.setChannelAccess(channel.id, restricted, ids));
  };

  return (
    <li data-testid={`access-${channel.name}`}>
      <Check
        checked={channel.restricted}
        testId="access-restricted"
        onChange={(on) => apply(on, roleIds ?? [])}
      >
        <strong>
          {channel.kind === 'voice' ? '🔊' : '#'} {channel.name}
        </strong>
        <span className="muted">nur für bestimmte Rollen</span>
      </Check>
      {channel.restricted && (
        <div className="role-chips">
          {roles.length === 0 && (
            <span className="muted">Noch keine Rollen, nur du siehst ihn.</span>
          )}
          {roles.map((r) => (
            <Check
              key={r.id}
              checked={roleIds?.includes(r.id) ?? false}
              testId={`access-role-${r.name}`}
              onChange={(on) =>
                apply(
                  true,
                  on ? [...(roleIds ?? []), r.id] : (roleIds ?? []).filter((id) => id !== r.id),
                )
              }
            >
              {r.name}
            </Check>
          ))}
        </div>
      )}
    </li>
  );
}

function BansTab({ guildId, run }: { guildId: string; run: Run }) {
  const [bans, setBans] = useState<GuildBanDto[] | null>(null);
  const load = useCallback(() => {
    api.listBans(guildId).then(
      (r) => setBans(r.bans),
      () => setBans([]),
    );
  }, [guildId]);
  useEffect(load, [load]);
  if (bans?.length === 0) return <p className="muted">Niemand ist gesperrt.</p>;
  return (
    <ul className="admin-members">
      {bans?.map((b) => (
        <li key={b.user.id} data-testid={`ban-${b.user.username}`}>
          <div className="admin-member-head">
            <Avatar name={nameOf(b.user)} url={b.user.avatarUrl} size="sm" />
            <strong>{nameOf(b.user)}</strong>
            <button
              className="btn small"
              data-testid="ban-remove"
              onClick={() => void run(() => api.unbanMember(guildId, b.user.id)).then(load)}
            >
              Entsperren
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}

type Tab = 'roles' | 'members' | 'channels' | 'bans' | 'invite';

/** Everything about who may do what on a server; shows only what you have the rights for. */
export function ServerAdminDialog({ guild, onClose }: { guild: GuildDto; onClose: () => void }) {
  const current = useChatStore((s) => s.guilds.find((g) => g.id === guild.id)) ?? guild;
  const selfId = useAuthStore((s) => s.user?.id);
  const roles = useChatStore((s) => s.rolesByGuild[guild.id]?.roles ?? NO_ROLES);
  const mine = useChatStore((s) => s.rolesByGuild[guild.id]?.myPermissions);
  const channels = useChatStore((s) => s.channelsByGuild[guild.id] ?? NO_CHANNELS);
  const isOwner = guild.ownerId === selfId;
  const can = (p: GuildPermission) => !!mine?.includes(p);
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    {
      id: 'members',
      label: 'Mitglieder',
      show: can('kick_members') || can('ban_members') || isOwner,
    },
    { id: 'roles', label: 'Rollen', show: isOwner },
    { id: 'channels', label: 'Kanäle', show: can('manage_channels') },
    { id: 'bans', label: 'Sperren', show: can('ban_members') },
    { id: 'invite', label: 'Einladung', show: can('manage_invites') },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab ?? visible[0]?.id ?? null;
  const [error, setError] = useState<string | null>(null);

  const run: Run = useCallback(async (action) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  return (
    <Modal title="Rollen & Mitglieder" onClose={onClose} testId="server-admin">
      <div className="admin-tabs" role="tablist">
        {visible.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active}
            className={t.id === active ? 'active' : ''}
            data-testid={`admin-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          <Icon name="alert" size={16} /> {error}
        </p>
      )}
      {active === 'members' && (
        <MembersTab guild={guild} roles={roles} isOwner={isOwner} can={can} run={run} />
      )}
      {active === 'roles' && <RolesTab guildId={guild.id} roles={roles} run={run} />}
      {active === 'channels' && (
        <>
          <ChannelOrganizer guildId={guild.id} run={run} />
          <h3 className="settings-subheading">Wer sieht welchen Kanal</h3>
          <ul className="admin-channels">
            {channels.map((c) => (
              <ChannelAccess key={c.id} channel={c} roles={roles} run={run} />
            ))}
          </ul>
        </>
      )}
      {active === 'bans' && <BansTab guildId={guild.id} run={run} />}
      {active === 'invite' && <InviteSettings guild={current} />}
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Fertig
        </button>
      </div>
    </Modal>
  );
}
