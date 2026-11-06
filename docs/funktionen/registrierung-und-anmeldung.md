# Registrierung, Anmeldung, Passwort

[Alle Funktionen](README.md)

Konto anlegen und wieder hineinkommen.

## Bedienung

- Registrieren, Link aus der Mail öffnen.
- Passwort vergessen auf der Anmeldeseite.

## Regeln und Grenzen

- Das Konto entsteht erst mit dem Bestätigungslink.
- Passwort: mindestens 10 Zeichen, 3 von 4 Zeichenarten oder ab 16 beliebig, nichts Häufiges.
- Reset-Link 30 Minuten, beendet alle Sitzungen. Mit Zwei-Faktor folgt die normale Anmeldung.

## Technik

- `backend/src/services/auth.service.ts`, Argon2id
- Sitzungs-Cookie `sid`, nur der Hash liegt in der DB
- `shared/src/password.ts`

## Tests

- `backend/test/auth.test.ts`, `verification.test.ts`, `password.test.ts`
- `e2e/tests/auth.spec.ts`
