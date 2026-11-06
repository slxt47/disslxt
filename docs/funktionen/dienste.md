# Dienste-Übersicht

[Alle Funktionen](README.md)

`/dienste` zeigt Admins, welche eigenen Dienste antworten.

## Bedienung

- `/dienste` ins Eingabefeld tippen, die Liste aktualisiert sich alle 30 Sekunden.

## Regeln und Grenzen

- Nur für Admins und Owner.
- Geprüft wird höchstens einmal pro Minute, egal wie viele schauen.
- Weiterleitung oder Login-Seite zählt als läuft, ab 500 als gestört.

## Technik

- `backend/src/services/status.service.ts`, `GET /api/admin/status`
- Liste in `.env`: `STATUS_TARGETS=Name=https://…,Name=https://…`
- `frontend/src/components/StatusDialog.tsx`

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/webhooks.spec.ts`
