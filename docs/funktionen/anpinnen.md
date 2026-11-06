# Anpinnen

[Alle Funktionen](README.md)

Wichtige Nachrichten griffbereit halten.

## Bedienung

- Pin an der Nachricht, das Pin-Symbol oben zeigt alle.
- Tipp in der Liste springt zur Nachricht.

## Regeln und Grenzen

- Auf Servern braucht es `manage_messages`, in privaten Chats dürfen alle.
- Höchstens 50 pro Kanal.

## Technik

- `messages.pinned_at`
- `POST /api/messages/:id/pin`, `GET /api/channels/:id/pins`
- `components/PinsPanel.tsx`

## Tests

- `backend/test/chat-features.test.ts`, `roles-permissions.test.ts`
- `e2e/tests/chat-features.spec.ts`
