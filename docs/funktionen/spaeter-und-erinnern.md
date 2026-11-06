# Später senden und Erinnern

[Alle Funktionen](README.md)

Nachrichten planen und sich selbst erinnern lassen.

## Bedienung

- `/später 30m Text` sendet später, `/erinnern 1h Text` erinnert nur dich.
- Zeiten: `30m`, `2h`, `3d`, `20:00`, `8.11.`, `8.11. 20:00`.
- Einstellungen → Geplant zeigt alles und bricht ab.

## Regeln und Grenzen

- Höchstens 50 geplante Dinge, höchstens ein Jahr voraus.
- Beim Senden gelten die normalen Rechte: Wer den Kanal nicht mehr sehen darf, sendet nichts und bekommt eine Mitteilung.
- Genauigkeit etwa 15 Sekunden.

## Technik

- `backend/src/services/schedule.service.ts`, Tabelle `scheduled_messages`
- `tick` nimmt fällige Zeilen zuerst heraus, so geht nichts doppelt raus
- `parseWhen` in `frontend/src/lib/commands.ts`
- `components/ScheduledSettings.tsx`

## Tests

- `backend/test/chat-features.test.ts`
- `frontend/src/__tests__/chatFeatures.test.tsx`
- `e2e/tests/polls-switcher.spec.ts`
