# Begrüßung neuer Mitglieder

[Alle Funktionen](README.md)

Eine kleine animierte Zeile, wenn jemand beitritt.

## Bedienung

- Erscheint von selbst im obersten offenen Textkanal.

## Regeln und Grenzen

- Keine Mitteilung, zählt nicht als ungelesen, keine Reaktionen.

## Technik

- Nachricht `kind = 'join'`, `MessageService.joined`
- Text und Winken in `MessageItem.tsx`

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/chat-features.spec.ts`
