# Sprachnachrichten abschreiben

[Alle Funktionen](README.md)

Text unter Sprachnachrichten, erzeugt auf dem eigenen Server.

## Bedienung

- Läuft von selbst, der Text erscheint kurz nach der Aufnahme.
- Abgeschriebene Nachrichten findet die Suche.

## Regeln und Grenzen

- Fest auf Deutsch eingestellt, automatische Erkennung lag bei kurzen Aufnahmen daneben.
- Audio verlässt den Server nie: Der Container hängt nur am internen Netz `speech`.
- Eine Aufnahme nach der anderen, höchstens 50 warten. Schlägt es fehl, bleibt die Sprachnachricht ohne Text.
- Nur neue Aufnahmen, alte bleiben ohne Text.

## Technik

- `deploy/whisper.Dockerfile` (whisper.cpp v1.9.5, Modell base, Prüfsumme)
- `backend/src/lib/whisper.ts`, `backend/src/services/transcription.service.ts`
- Text steht in `messages.content`, Ankunft als `message.updated`
- `WHISPER_URL`, Compose-Profil `whisper`, höchstens 4 Kerne und 1,5 GB

## Tests

- `backend/test/search-and-links.test.ts` mit Test-Erkennung
- `frontend/src/__tests__/chatFeatures.test.tsx`
- Am 06.11. mit Testsprache geprüft: 8 s Audio in 2 bis 4 s, der Container hat kein Internet. Künstliche Stimme nur mäßig erkannt, echte Stimmen noch offen
