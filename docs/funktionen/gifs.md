# GIFs

[Alle Funktionen](README.md)

GIF-Suche über GIPHY direkt im Eingabefeld.

## Bedienung

- Knopf GIF, suchen oder Trends, antippen schickt es.

## Regeln und Grenzen

- Nur eingebettet, nie kopiert, so verlangen es die GIPHY-Bedingungen.
- Ohne `GIPHY_API_KEY` gibt es keinen Knopf.
- Filter pg-13, Ergebnisse 5 Minuten zwischengespeichert.

## Technik

- `backend/src/services/gif.service.ts`, `routes/gif.routes.ts`
- `frontend/src/components/Gif.tsx`

## Tests

- `e2e/tests/groups-gifs.spec.ts`
