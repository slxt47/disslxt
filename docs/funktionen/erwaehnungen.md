# Erwähnungen

[Alle Funktionen](README.md)

`@name` ruft jemanden gezielt und benachrichtigt ihn.

## Bedienung

- `@` und den Namensanfang tippen, mit Pfeilen wählen, `Enter` oder `Tab`.
- Eigene Erwähnungen sind farbig, die Nachricht ist hervorgehoben.

## Regeln und Grenzen

- Erwähnungen kommen auch bei stummgeschaltetem Server an.
- Nicht in Code und nicht in Mailadressen.
- Enter sendet, wenn der Name schon vollständig ist.

## Technik

- `activeToken` in `Composer.tsx`, `mentionsUser` in `lib/markdown.tsx`
- `mentionedNames` in `push.service.ts`
- Zähler `mentions` in `GET /api/unread`

## Tests

- `frontend/src/__tests__/chatFeatures.test.tsx`
- `e2e/tests/pwa-push.spec.ts`
