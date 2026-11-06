# Gruppenchats

[Alle Funktionen](README.md)

Private Runden bis 10 Personen.

## Bedienung

- Unterhaltungen → Plus, mindestens zwei Freunde wählen.

## Regeln und Grenzen

- Alle dürfen schreiben, anrufen, umbenennen und eigene Freunde hinzufügen.
- Entfernen kann nur, wer die Gruppe erstellt hat.
- Wer als Letztes geht, löscht sie samt Inhalt.

## Technik

- Kanal der Art `group`, `channels.owner_id`
- `components/GroupDialogs.tsx`

## Tests

- `backend/test/social.test.ts`
- `e2e/tests/groups-gifs.spec.ts`
