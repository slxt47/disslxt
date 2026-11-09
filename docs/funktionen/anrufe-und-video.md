# Anrufe und Video

[Alle Funktionen](README.md)

Sprach- und Videoanrufe in privaten Chats und Gruppen, Kamera auch im Sprachkanal.

## Bedienung

- Telefon oder Kamera oben im Chat, beim Gegenüber klingelt es.
- Kamera-Knopf im Anruf.

## Regeln und Grenzen

- Zwischen zweien nur unter Freunden.
- 640×480, höchstens 600 kbit/s pro Verbindung.

## Technik

- Gleiches Mesh, die Kamera wird per `replaceTrack` getauscht
- Events `call.ring`, `call.ended`, `voice.peer-video`
- `components/CallTiles.tsx`, `IncomingCall.tsx`

## Tests

- `backend/test/social.test.ts`
- `frontend/src/__tests__/voiceClient.test.tsx`
