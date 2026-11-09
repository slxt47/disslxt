# Barrierefreiheit

[Alle Funktionen](README.md)

disslxt soll mit Tastatur, Screenreader und schlechten Augen benutzbar sein.

## Bedienung

- Sichtbarer Fokusring bei Tastaturbedienung.
- Geräteeinstellungen werden befolgt: „Bewegung reduzieren“, „Transparenz reduzieren“, „Kontrast erhöhen“, erzwungene Farben.

## Regeln und Grenzen

- Text mindestens 4,5:1 Kontrast, in beiden Modi und allen fertigen Themes. Eigene Themes werden automatisch nachgezogen.
- Der Himmel steht still: Bewegung hinter Text wäre ein Verstoß gegen WCAG 2.2.2. Darum keine Sternschnuppen wie auf slxt.dev.
- Flächen sind fast deckend, die Sterne stören den Text nicht.

## Technik

- Kontraste berechnet in `frontend/src/__tests__/contrast.test.ts`
- axe prüft in `e2e/tests/a11y.spec.ts`, `a11y-views.spec.ts` und `sites-a11y.spec.ts` gegen WCAG 2.0 bis 2.2 AA
- Klickflächen mindestens 24 × 24 px (WCAG 2.5.8), z. B. der Antwort-Hinweis über Nachrichten
- Links im Fließtext der Webseiten sind unterstrichen, nicht nur farbig (WCAG 1.4.1)
- `@media (prefers-reduced-transparency)`, `(prefers-contrast: more)`, `(forced-colors: active)` in `styles.css`

## Tests

- `frontend/src/__tests__/contrast.test.ts`
- `e2e/tests/a11y.spec.ts`: Anmeldung, Chat, Einstellungen, Springen, Kanal, Suche, Freunde, hell und dunkel
- `e2e/tests/a11y-views.spec.ts`: Sprachkanal, Bildschirm teilen, Anruf (eingehend, klingelt, läuft), Thread, Server-Einstellungen, alle Reiter der Server-Verwaltung, hell und dunkel
- `e2e/tests/sites-a11y.spec.ts`: Produktseite, Impressum, Datenschutz, Hilfe und beide 404-Seiten, hell und dunkel (läuft nur mit `SITES_WEB_URL` und `SITES_HILFE_URL`)
- Automatische Prüfungen finden nicht alles: nicht mit echtem Screenreader getestet
