# Link-Vorschau

[Alle Funktionen](README.md)

Titel, Text und Bild unter Nachrichten mit Link.

## Bedienung

- Erscheint von selbst kurz nach dem Senden.
- Eigene Nachricht: X an der Vorschau entfernt sie.
- `<https://…>` in spitzen Klammern sendet ohne Vorschau.

## Regeln und Grenzen

- Nur der erste Link, nicht in Code.
- Der Server holt die Seite, Browser der anderen kontaktieren sie nicht. Bilder sind geprüfte Kopien bis 2 MB.
- Die verlinkte Seite sieht den Abruf vom Server, auch bei Links aus privaten Chats.
- Gleicher Link: 7 Tage aus dem Zwischenspeicher. Ungenutzte Vorschauen verschwinden.
- `LINK_PREVIEWS=false` schaltet alles ab.

## Technik

- `backend/src/lib/safeFetch.ts`: nur http/https auf 80 und 443, jede aufgelöste Adresse wird beim Verbinden geprüft, Weiterleitungen auch, höchstens 3, 5 Sekunden, 512 KB
- `backend/src/lib/linkMeta.ts` liest den Kopf als reinen Text
- `backend/src/services/linkPreview.service.ts`, Tabelle `link_previews`, `UPLOAD_DIR/previews`
- `POST /api/messages/:id/hide-preview`, `GET /api/link-images/:key`
- Fertige Vorschau kommt als `message.updated`

## Tests

- `backend/test/search-and-links.test.ts` mit den Adressbereichen
- Echter Abruf am 06.11. geprüft: öffentliche Seiten gehen, 169.254.169.254, localhost und Docker-Namen nicht
- Nicht mit echtem Konto auf der Live-Seite getestet
