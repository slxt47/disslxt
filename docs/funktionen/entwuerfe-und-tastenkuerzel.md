# Entwürfe und Tastenkürzel

[Alle Funktionen](README.md)

Halbfertiger Text bleibt, Bedienung geht ohne Maus.

## Bedienung

- Ungesendeter Text bleibt pro Kanal stehen.
- `Alt+↑/↓` wechselt den Kanal, `↑` im leeren Feld bearbeitet die letzte eigene Nachricht, `Esc` bricht ab.

## Regeln und Grenzen

- Entwürfe liegen nur im Browser und werden beim Abmelden gelöscht.

## Technik

- `frontend/src/lib/drafts.ts`, Tastenkürzel in `pages/AppLayout.tsx` und `Composer.tsx`

## Tests

- `frontend/src/__tests__/chatFeatures.test.tsx`
- `e2e/tests/chat-features.spec.ts`
