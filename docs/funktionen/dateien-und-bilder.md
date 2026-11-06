# Dateien und Bilder

[Alle Funktionen](README.md)

Dateien im Chat teilen, Bilder groß ansehen.

## Bedienung

- Büroklammer, Ziehen in den Chat oder Einfügen mit Strg/Cmd+V.
- Bilder öffnen per Tipp im Vollbild mit Zoom und Download.

## Regeln und Grenzen

- Höchstens 25 MB pro Datei.
- Nur echte Bilder (an den Bytes erkannt) erscheinen im Chat, alles andere ist reiner Download.
- Abrufen nur, wer den Kanal sehen darf. Alles zusammen höchstens 40 GB.

## Technik

- `backend/src/routes/file.routes.ts`, `UPLOAD_DIR/files`
- `frontend/src/components/FileAttachment.tsx`, `Lightbox.tsx`, `UploadQueue.tsx`

## Tests

- `backend/test/files.test.ts`
- `e2e/tests/files.spec.ts`
