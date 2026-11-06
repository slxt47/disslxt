# Sprachkanäle

[Alle Funktionen](README.md)

Offene Räume zum Reden.

## Bedienung

- Sprachkanal öffnen, Beitreten, Geräte wählen.
- Die Leiste bleibt beim Lesen anderer Kanäle.
- Grüner Ring zeigt, wer spricht, auch in der Seitenleiste.

## Regeln und Grenzen

- Bis zu 6 Personen, ein Kanal pro Person.
- „Wer spricht“ in der Seitenleiste nur für den eigenen Kanal.

## Technik

- WebRTC-Mesh, `frontend/src/voice/VoiceClient.ts`
- Signalisierung über WebSocket, Audio läuft direkt zwischen Browsern
- TURN über Cloudflare, Monatslimit `TURN_MONTHLY_LIMIT_GB`

## Tests

- `backend/test/voice-channels.test.ts`, `turn-usage.test.ts`
- `frontend/src/__tests__/voiceClient.test.tsx`
- `e2e/tests/voice-channel.spec.ts`, `turn-relay.spec.ts`
