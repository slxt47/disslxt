# Ungelesen

[Alle Funktionen](README.md)

Zeigt auf jedem Gerät, was neu ist.

## Bedienung

- Kanäle mit Neuem sind fett und zeigen die Zahl, farbig bei Erwähnung.
- Strich am Server, Zahl bei Erwähnungen.
- Linie „Neue Nachrichten“ im Kanal.

## Regeln und Grenzen

- Der Stand liegt am Server und gilt auf allen Geräten.
- Neue Mitglieder zählen ab Beitritt, Begrüßungen zählen nicht.
- Der Lesestand rückt nie zurück und nie über die letzte Nachricht hinaus.

## Technik

- Tabelle `channel_reads`
- `GET /api/unread`, `POST /api/channels/:id/read`
- Events `channel.activity` (Server), `channel.read` (eigene Geräte)
- Migration 0012 hat alles Vorhandene als gelesen markiert

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/chat-features.spec.ts`
