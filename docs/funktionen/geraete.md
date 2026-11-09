# Angemeldete Geräte

[Alle Funktionen](README.md)

Sehen und beenden, wo man angemeldet ist.

## Bedienung

- Einstellungen → Sicherheit: Liste, einzeln abmelden oder „Überall sonst abmelden“.

## Regeln und Grenzen

- Gespeichert werden Browser, System und letzte Aktivität, keine IP-Adresse.
- Abmelden wirkt sofort, auch auf offene Verbindungen.

## Technik

- `sessions.device`, `sessions.last_seen_at` (alle 5 Minuten)
- `GET /api/account/sessions`, `DELETE /api/account/sessions/:id`, `POST /api/account/sessions/end-others`

## Tests

- `backend/test/security-account.test.ts`
- `e2e/tests/account-security.spec.ts`
