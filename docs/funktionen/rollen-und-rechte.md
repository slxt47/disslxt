# Rollen und Rechte

[Alle Funktionen](README.md)

Pro Server festlegen, wer was darf und wer welchen Kanal sieht.

## Bedienung

- Rollen & Mitglieder → Rollen: Name, Farbe, Rechte, Reihenfolge.
- Reiter Mitglieder: Rollen vergeben.
- Reiter Kanäle: geschützte Kanäle mit Rollen.

## Regeln und Grenzen

- Rollen verwaltet nur der Besitzer, keine Rolle kann das weitergeben.
- Rechte: `manage_channels`, `manage_messages`, `manage_invites`, `kick_members`, `ban_members`.
- Ein Recht öffnet keinen geschützten Kanal.
- Höchstens 20 Rollen. Rollenverlust wirkt sofort, auch im Anruf.

## Technik

- `backend/src/services/permission.service.ts`, `role.service.ts`
- `channelVisibleSql` ist die eine Definition für Listen, Ungelesen und Push
- `hub.applyChannelAccess` wirft Sockets und Anrufer raus
- Event `guild.roles-changed`
- `components/ServerAdminDialog.tsx`

## Tests

- `backend/test/roles-permissions.test.ts`
- `e2e/tests/roles.spec.ts`
