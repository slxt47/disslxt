# Nachrichten

[Alle Funktionen](README.md)

Text in Kanälen und privaten Chats, in Echtzeit bei allen, die den Kanal offen haben.

## Bedienung

- `Enter` sendet, `Shift+Enter` macht eine neue Zeile.
- Eigene Nachricht: Maus darüber oder antippen, dann Bearbeiten oder Löschen.
- „Ältere laden“ holt weiter zurückliegende Nachrichten.
- Nachrichten derselben Person kurz hintereinander werden zusammengefasst, dazu Tages-Trenner.

## Regeln und Grenzen

- Höchstens 2000 Zeichen, gezählt in Code Points (ein Emoji zählt als eins).
- Ändern kann nur der Autor. Löschen zusätzlich, wer `manage_messages` hat und höher steht.
- Sprachnachrichten, Dateien und GIFs lassen sich nicht bearbeiten.

## Technik

- `backend/src/services/message.service.ts`, `routes/message.routes.ts`
- `GET/POST /api/channels/:id/messages`, `PATCH/DELETE /api/messages/:id`
- Events `message.created`, `message.updated`, `message.deleted`
- Tabelle `messages`, Seiten mit `before`, 50 pro Abruf
- `frontend/src/components/MessageList.tsx`, `MessageItem.tsx`, `Composer.tsx`

## Tests

- `backend/test/messages.test.ts`
- `e2e/tests/realtime-chat.spec.ts`, `composer.spec.ts`, `history-reload.spec.ts`
