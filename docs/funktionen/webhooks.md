# Webhooks und Bot-Nachrichten

[Alle Funktionen](README.md)

Programme schreiben als Bot in einen Textkanal.

## Bedienung

- Kanal bearbeiten → Webhooks: Name eingeben, Anlegen. Adresse und Schlüssel erscheinen einmal.
- `POST /api/hooks/<id>` mit `Authorization: Bearer <schlüssel>` und JSON `{"content":"Text"}`.
- Löschen beendet den Zugang sofort.

## Regeln und Grenzen

- Anlegen und Löschen braucht `manage_channels`.
- Bis 2000 Zeichen, Bot-Nachrichten lassen sich nicht bearbeiten.
- Der Schlüssel steht in einer Kopfzeile, damit er nicht in Zugriffslogs landet. Gespeichert wird nur sein Hash.
- Falsche ID und falscher Schlüssel antworten gleich (404).
- Geschützte Kanäle bleiben geschützt, ein Webhook öffnet sie nicht.

## Technik

- `backend/src/services/webhook.service.ts`, `routes/webhook.routes.ts`
- Tabelle `channel_webhooks`, Nachrichtenart `bot` mit `bot_name`, Autor ist der Ersteller
- `~/disslxt-schutz/server-kanal-anbinden.sh` legt `#server` an und hängt `ntfy-send.sh` daran

## Tests

- `backend/test/chat-features.test.ts`
- `e2e/tests/webhooks.spec.ts`
