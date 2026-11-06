# Mitteilungen

[Alle Funktionen](README.md)

Push auf Handy und Computer, auch bei geschlossener App.

## Bedienung

- Einstellungen → Mitteilungen aktivieren.
- Glocke neben dem Servernamen schaltet stumm.

## Regeln und Grenzen

- Keine Mitteilung für einen Kanal, den man gerade sichtbar offen hat.
- Geschützte Kanäle melden nur an Berechtigte.
- Auf dem iPhone nur als Home-Bildschirm-App.

## Technik

- `backend/src/services/push.service.ts`, VAPID-Schlüssel
- `frontend/public/sw.js`, `frontend/src/pwa/`

## Tests

- `backend/test/push.test.ts`
- `e2e/tests/pwa-push.spec.ts`
