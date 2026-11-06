# Befehle

[Alle Funktionen](README.md)

Kurzbefehle im Eingabefeld, sie senden normalen Text.

## Bedienung

- `/` am Anfang zeigt die Liste.
- `/shrug`, `/tableflip`, `/unflip`, `/me winkt`, `/würfeln`, `/würfeln 20`, `/münze`.
- `//text` sendet eine Zeile, die mit `/` beginnt.

## Regeln und Grenzen

- Würfeln läuft im Browser, ist also nicht fälschungssicher.
- Unbekannte Befehle gehen als normaler Text raus.
- Für Befehle gibt es keinen „schreibt gerade“-Hinweis.

## Technik

- `frontend/src/lib/commands.ts`, Zufall aus `crypto.getRandomValues`

## Tests

- `frontend/src/__tests__/chatFeatures.test.tsx`
- `e2e/tests/chat-features.spec.ts`
