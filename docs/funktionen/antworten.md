# Antworten mit Zitat

[Alle Funktionen](README.md)

Eine Nachricht bezieht sich sichtbar auf eine andere.

## Ansicht

![Antworten mit Zitat, dunkel](../../sites/hilfe/bilder/reaktionen-dunkel.webp)

Hell: [reaktionen-hell.webp](../../sites/hilfe/bilder/reaktionen-hell.webp). Die Bilder macht `e2e/tests/hilfe-bilder.spec.ts`.

## Bedienung

- An der Nachricht auf Antworten tippen, über dem Eingabefeld steht dann das Zitat.
- `Esc` bricht ab.
- Tipp auf das Zitat springt zum Original.

## Regeln und Grenzen

- Nur im selben Kanal.
- Wird das Original gelöscht, bleibt die Antwort ohne Zitat.
- Wer eine Antwort bekommt, wird wie bei einer Erwähnung benachrichtigt.

## Technik

- `messages.reply_to_id`, `ON DELETE SET NULL`
- `replyToId` beim Senden, `replyTo` im `MessageDto`

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/chat-features.spec.ts`
