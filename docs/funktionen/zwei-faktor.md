# Zwei-Faktor-Anmeldung

[Alle Funktionen](README.md)

Zweiter Code aus einer Authenticator-App.

## Bedienung

- Einstellungen → Sicherheit → Einrichten, Passwort, QR-Code scannen, Code eingeben, Ersatzcodes sichern.
- Anmeldung: Passwort, dann Code oder Ersatzcode.

## Regeln und Grenzen

- Freiwillig. Ein Code gilt einmal, 10 Ersatzcodes je einmal.
- 10 Fehlversuche sperren das Konto 15 Minuten.
- Ausschalten braucht Passwort und Code.
- Geht `TWO_FACTOR_KEY` verloren, helfen nur Ersatzcodes.

## Technik

- `backend/src/lib/totp.ts` (RFC 6238), `lib/secretBox.ts` (AES-256-GCM)
- `backend/src/services/security.service.ts`
- `POST /api/auth/login/two-factor`, Ticket 5 Minuten
- Tabellen `login_challenges`, `recovery_codes`
- fail2ban-Filter `disslxt-auth` deckt den zweiten Schritt ab

## Tests

- `backend/test/security-account.test.ts`
- `e2e/tests/account-security.spec.ts`
- Noch nicht mit echter App am Handy getestet
