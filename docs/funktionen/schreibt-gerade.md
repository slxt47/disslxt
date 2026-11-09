# Schreibt gerade

[Alle Funktionen](README.md)

Zeigt, wer gerade tippt.

## Bedienung

- Erscheint über dem Eingabefeld, ohne dass etwas zu tun ist.

## Regeln und Grenzen

- Nur für Leute, die den Kanal offen haben.
- Der Client meldet alle 3 Sekunden, der Server gibt höchstens alle 500 ms weiter.
- Anzeige endet nach 5 Sekunden oder mit der Nachricht.

## Technik

- WebSocket-Frame `typing`, nur für den abonnierten Kanal
- `frontend/src/store/typing.ts`

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/chat-features.spec.ts`
