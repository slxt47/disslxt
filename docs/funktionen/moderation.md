# Entfernen und Sperren

[Alle Funktionen](README.md)

Mitglieder vom Server nehmen.

## Bedienung

- Rollen & Mitglieder → Mitglieder: Entfernen oder Sperren.
- Reiter Sperren: wieder freigeben.

## Regeln und Grenzen

- Entfernte können per Link zurück, Gesperrte nicht.
- Nur bei Mitgliedern unter dem eigenen Rang, nie beim Besitzer.
- Ihre Nachrichten bleiben. Betroffene erfahren es sofort.

## Technik

- `DELETE /api/guilds/:id/members/:userId`, `GET/POST /api/guilds/:id/bans`
- Tabelle `guild_bans`, Fehlercode `BANNED`
- Rang in `PermissionService.assertOutranks`

## Tests

- `backend/test/roles-permissions.test.ts`
- `e2e/tests/roles.spec.ts`
