# Emoji-Auswahl und Kürzel

[Alle Funktionen](README.md)

Emoji einfügen per Auswahl oder `:kürzel:`.

## Bedienung

- Smiley im Eingabefeld öffnet die Auswahl mit Suche, auch auf Deutsch.
- `:th` zeigt Vorschläge, `:thumbsup:` wird sofort 👍.

## Regeln und Grenzen

- Rund 200 Emoji, fest im Code, ohne Fremddienst.
- In Code bleiben Kürzel unverändert.

## Technik

- `frontend/src/lib/emoji.ts`, `components/EmojiPanel.tsx`

## Tests

- `frontend/src/__tests__/chatFeatures.test.tsx`
