# Umfragen

[Alle Funktionen](README.md)

Abstimmen direkt im Chat.

## Bedienung

- `/umfrage Frage | Antwort A | Antwort B` senden.
- Antwort antippen, nochmal nimmt die Stimme zurück.

## Regeln und Grenzen

- 2 bis 10 Antworten. Alle sehen, wer wofür gestimmt hat.
- Nicht bearbeitbar, löschen geht wie bei Nachrichten.

## Technik

- Nachricht `kind = 'poll'`, Tabellen `polls`, `poll_votes`
- `POST /api/channels/:id/polls`, `POST /api/messages/:id/vote`, Event `message.poll`
- `components/PollView.tsx`

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/polls-switcher.spec.ts`
