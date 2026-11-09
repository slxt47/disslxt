import { useState } from 'react';
import type { PollDto } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';

/** A poll in the chat: tap an option to vote, tap it again to take the vote back. */
export function PollView({
  messageId,
  channelId,
  question,
  poll,
  selfId,
}: {
  messageId: string;
  channelId: string;
  question: string;
  poll: PollDto;
  selfId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const voters = new Set(poll.options.flatMap((o) => o.userIds));
  const total = voters.size;

  async function vote(option: number) {
    setError(null);
    try {
      const { poll: next } = await api.vote(messageId, option);
      useChatStore.getState().setPoll(channelId, messageId, next);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="poll" data-testid="poll">
      <strong>📊 {question}</strong>
      <ul>
        {poll.options.map((o, i) => {
          const mine = !!selfId && o.userIds.includes(selfId);
          const share = total ? Math.round((o.userIds.length / total) * 100) : 0;
          return (
            <li key={i}>
              <button
                type="button"
                className={mine ? 'mine' : ''}
                aria-pressed={mine}
                data-testid={`poll-option-${i}`}
                onClick={() => void vote(i)}
              >
                <span className="poll-bar" style={{ width: `${share}%` }} />
                <span className="poll-text">{o.text}</span>
                <span className="poll-count">
                  {o.userIds.length} · {share} %
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <small>
        {total === 1 ? '1 Stimme' : `${total} Stimmen`} · Mehrere Antworten möglich:{' '}
        {poll.multiple ? 'ja' : 'nein'}
      </small>
      {error && (
        <p className="form-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
