# Freunde

[Alle Funktionen](README.md)

Freundesliste mit Online-Anzeige.

## Bedienung

- Das „d“ oben links, dann Benutzername eingeben.
- Annehmen, ablehnen, zurückziehen, entfernen.

## Regeln und Grenzen

- Höchstens 50 offene Anfragen. Gleichzeitige Anfragen machen direkt befreundet.

## Technik

- `backend/src/services/friend.service.ts`, Tabelle `friendships`
- Events `friend.updated`, `friend.removed`, `friend.presence`

## Tests

- `backend/test/social.test.ts`
- `e2e/tests/friends-dm.spec.ts`
