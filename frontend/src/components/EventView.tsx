import { useState } from 'react';
import type { EventDto, RsvpAnswer } from '@disslxt/shared';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useChatStore } from '../store/chat';

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'full', timeStyle: 'short' });
const ANSWERS: { id: RsvpAnswer; label: string }[] = [
  { id: 'yes', label: 'Bin dabei' },
  { id: 'maybe', label: 'Vielleicht' },
  { id: 'no', label: 'Kann nicht' },
];

/** An event in the chat with yes, maybe and no; the same answer again takes it back. */
export function EventView({
  messageId,
  channelId,
  title,
  event,
  selfId,
}: {
  messageId: string;
  channelId: string;
  title: string;
  event: EventDto;
  selfId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const mine = ANSWERS.find((a) => selfId && event[a.id].includes(selfId))?.id ?? null;

  async function answer(next: RsvpAnswer) {
    setError(null);
    try {
      const res = await api.rsvp(messageId, next === mine ? null : next);
      useChatStore.getState().setEvent(channelId, messageId, res.event);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="poll event" data-testid="event">
      <strong>📅 {title}</strong>
      <p className="event-date">{dateFormat.format(new Date(event.startsAt))}</p>
      <div className="event-answers">
        {ANSWERS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={mine === a.id ? 'mine' : ''}
            aria-pressed={mine === a.id}
            data-testid={`event-${a.id}`}
            onClick={() => void answer(a.id)}
          >
            {a.label} ({event[a.id].length})
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
