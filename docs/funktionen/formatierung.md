# Text formatieren und Links

[Alle Funktionen](README.md)

Einfaches Markdown und klickbare Links in Nachrichten.

## Bedienung

- `**fett**`, `*kursiv*` oder `_kursiv_`, `~~durch~~`, `` `Code` ``.
- Drei Backticks davor und danach ergeben einen Codeblock.
- `https://…` wird von selbst ein Link.
- `\*` zeigt das Zeichen selbst.

## Regeln und Grenzen

- Es entsteht nie HTML aus getipptem Text.
- Links nur für http und https, `rel="noopener noreferrer nofollow ugc"`.
- Satzzeichen hinter einem Link gehören nicht dazu.

## Technik

- `frontend/src/lib/markdown.tsx` baut React-Elemente
- Von Hand geschrieben: Lookbehind im RegExp würde ältere Safari am Start hindern

## Tests

- `frontend/src/__tests__/chatFeatures.test.tsx`
- `e2e/tests/chat-features.spec.ts`
