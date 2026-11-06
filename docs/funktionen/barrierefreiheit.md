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
- axe prüft in `e2e/tests/a11y.spec.ts` gegen WCAG 2.0 bis 2.2 AA
- `@media (prefers-reduced-transparency)`, `(prefers-contrast: more)`, `(forced-colors: active)` in `styles.css`

## Tests

- `frontend/src/__tests__/contrast.test.ts`
- `e2e/tests/a11y.spec.ts`: Anmeldung, Chat, Einstellungen, Springen, Kanal, Suche, Freunde, hell und dunkel
- Automatische Prüfungen finden nicht alles: nicht mit echtem Screenreader getestet
