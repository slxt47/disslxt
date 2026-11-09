# Server und Einladungen

[Alle Funktionen](README.md)

Ein Server pro Gruppe, beitreten per Link.

## Bedienung

- Plus in der Serverleiste legt einen Server an.
- Servername oben → Leute einladen → Link kopieren.
- Server-Einstellungen: Name, Bild, Tag, Einladung.

## Regeln und Grenzen

- Höchstens 5 eigene Server pro Person.
- Einladung mit Ablauf und Nutzungszahl, „Neuen Link erzeugen“ macht den alten sofort ungültig.
- Löschen nur der Besitzer, mit dem Namen als Bestätigung.

## Technik

- `backend/src/services/guild.service.ts`
- `POST /api/guilds/:id/invite` (`expiresInHours`, `maxUses`, `regenerate`)
- Zählen und Beitreten in einer Transaktion
- `components/InviteSettings.tsx`

## Tests

- `backend/test/guilds.test.ts`, `guild-delete.test.ts`, `chat-features.test.ts`
- `e2e/tests/invite-join.spec.ts`
