# Private Chats

[Alle Funktionen](README.md)

Nachrichten zu zweit, mit allem, was Kanäle können.

## Bedienung

- Beim Freund auf Nachricht tippen.

## Regeln und Grenzen

- Nur unter Freunden. Danach bleibt der Verlauf lesbar, Schreiben und Anrufen gehen nicht mehr.
- Nicht Ende-zu-Ende-verschlüsselt.

## Technik

- Kanal der Art `dm` ohne Server, `channels.dm_key`, `dm_members`
- `backend/src/services/dm.service.ts`, `components/DmView.tsx`

## Tests

- `backend/test/social.test.ts`
- `e2e/tests/friends-dm.spec.ts`
