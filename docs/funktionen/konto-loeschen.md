# Konto löschen

[Alle Funktionen](README.md)

Das Konto und alles dazu selbst entfernen.

## Bedienung

- Einstellungen → Konto → Konto löschen, Passwort eingeben.

## Regeln und Grenzen

- Eigene Server gehen für alle mit. Aus Backups nach spätestens acht Wochen weg.

## Technik

- `backend/src/services/account.service.ts`
- `DELETE /api/users/me`

## Tests

- `e2e/tests/account-delete.spec.ts`
