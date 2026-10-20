import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { InvitePreviewDto } from '@chat-mvp/shared';
import { ApiRequestError, errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: InvitePreviewDto };

export function InvitePage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    api.invitePreview(code).then(
      (preview) => {
        if (!cancelled) setState({ kind: 'ready', preview });
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 404) setState({ kind: 'invalid' });
        else setState({ kind: 'error', message: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function accept(preview: InvitePreviewDto) {
    setBusy(true);
    setActionError(null);
    try {
      const guildId = preview.guild.id;
      if (!preview.alreadyMember) {
        const { guild } = await api.joinInvite(code);
        useChatStore.getState().upsertGuild(guild);
      }
      const { channels } = await api.listChannels(guildId);
      useChatStore.getState().setChannels(guildId, channels);
      const first = channels[0];
      navigate(first ? `/guilds/${guildId}/channels/${first.id}` : `/guilds/${guildId}`);
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-card invite-card">
        {state.kind === 'loading' && <p>Einladung wird geladen…</p>}
        {state.kind === 'invalid' && (
          <div data-testid="invite-invalid">
            <h1>Ungültige Einladung</h1>
            <p>Dieser Einladungslink ist ungültig oder abgelaufen.</p>
            <Link to="/">Zur Startseite</Link>
          </div>
        )}
        {state.kind === 'error' && (
          <p className="form-error" role="alert" data-testid="form-error">
            {state.message}
          </p>
        )}
        {state.kind === 'ready' && (
          <>
            <p className="muted">Du wurdest eingeladen, beizutreten:</p>
            <h1 data-testid="invite-guild-name">{state.preview.guild.name}</h1>
            <p className="muted" data-testid="invite-member-count">
              {state.preview.guild.memberCount}{' '}
              {state.preview.guild.memberCount === 1 ? 'Mitglied' : 'Mitglieder'}
            </p>
            {actionError && (
              <p className="form-error" role="alert" data-testid="form-error">
                {actionError}
              </p>
            )}
            <button
              className="btn primary"
              data-testid="invite-accept"
              disabled={busy}
              onClick={() => void accept(state.preview)}
            >
              {state.preview.alreadyMember ? 'Öffnen' : 'Beitreten'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
