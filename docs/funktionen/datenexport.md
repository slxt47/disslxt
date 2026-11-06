# Datenexport

[Alle Funktionen](README.md)

Eine Kopie der eigenen Daten als Datei.

## Bedienung

- Einstellungen → Sicherheit → Daten herunterladen.

## Regeln und Grenzen

- Enthält Konto, Server, Freunde, eigene Nachrichten, Reaktionen.
- Keine Hashes, keine Geheimnisse. Dateien nur mit Namen, nicht ihr Inhalt.
- 3 pro Stunde.

## Technik

- `GET /api/account/export`, `SecurityService.exportData`

## Tests

- `backend/test/security-account.test.ts`
- `e2e/tests/account-security.spec.ts`
