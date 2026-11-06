# Diktieren und Vorlesen

[Alle Funktionen](README.md)

Sprache zu Text und Text zu Sprache, im Browser.

## Bedienung

- Mikrofon im Eingabefeld diktiert, der Text ist vor dem Senden korrigierbar.
- Lautsprecher an der Nachricht liest vor.
- Einstellungen: neue Nachrichten automatisch vorlesen, Tempo.

## Regeln und Grenzen

- Diktieren nur in Chrome, Edge und Safari, sonst kein Knopf.

## Technik

- `frontend/src/speech/` (Web Speech API, `speechSynthesis`)

## Tests

- `frontend/src/__tests__/speech.test.tsx`
- `e2e/tests/speech.spec.ts`
