# Admin-Bereich

[Alle Funktionen](README.md)

Kontoweite Verwaltung für den Betreiber.

## Bedienung

- Admins und Owner sehen die Nutzerliste rechts und in den Einstellungen.

## Regeln und Grenzen

- Genau ein Owner, Admins werfen nur normale User raus.
- Rauswerfen beendet Sitzungen, ist aber keine Sperre.
- Getrennt von den Rollen pro Server.

## Technik

- `backend/src/services/admin.service.ts`
- `GET /api/admin/users`, `POST /api/admin/users/:id/kick`, `PUT /api/admin/users/:id/role`
- `scripts/admin-reset.sh` setzt alles zurück

## Tests

- `backend/test/roles.test.ts`
- `frontend/src/__tests__/admin.test.tsx`
