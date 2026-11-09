# Sprachnachrichten

[Alle Funktionen](README.md)

Kurze Aufnahmen statt Text.

## Bedienung

- Wellen-Symbol bei leerem Eingabefeld.

## Regeln und Grenzen

- Höchstens 2 Minuten und 5 MB.
- Nicht bearbeitbar, Löschen entfernt die Datei.

## Technik

- `MediaRecorder` im Browser, Server prüft die Signatur und wandelt mit ffmpeg nach AAC/m4a
- `POST /api/channels/:id/voice-messages`, Abruf mit HTTP-Range für Safari

## Tests

- `backend/test/voice.test.ts`, `ffmpeg.test.ts`
- `e2e/tests/voice-message.spec.ts`
