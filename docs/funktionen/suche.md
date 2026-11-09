# Suche

[Alle Funktionen](README.md)

Nachrichten finden, in allem, was man lesen darf.

## Ansicht

![Suche, dunkel](../../sites/hilfe/bilder/suche-dunkel.webp)

Hell: [suche-hell.webp](../../sites/hilfe/bilder/suche-hell.webp). Die Bilder macht `e2e/tests/hilfe-bilder.spec.ts`.

## Bedienung

- Lupe oben im Chat oder `Strg+Shift+F`.
- Worte tippen, auch nur den Wortanfang.
- Filter: Ort, Person, Datum.
- Tipp auf einen Treffer springt hin und lädt ältere Nachrichten nach.

## Regeln und Grenzen

- Sucht nur in Text, nicht in Dateinamen oder Sprachnachrichten.
- Alle Worte müssen vorkommen, keine Wortformen: `katz` findet Katze, `katzen` findet Katze nicht.
- Nachrichten ohne Leserecht erscheinen nie, auch nicht nach Verlassen eines Servers.
- Der Sprung reicht bis 1000 Nachrichten zurück.

## Technik

- `GET /api/search`, `MessageService.search`
- GIN-Index auf `to_tsvector('simple', content)`
- Nur Buchstaben und Ziffern erreichen die Abfrage
- `components/SearchDialog.tsx`

## Tests

- `backend/test/search-and-links.test.ts`
- `e2e/tests/search.spec.ts`
