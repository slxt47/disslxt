# Push-to-Talk und Rauschfilter

[Alle Funktionen](README.md)

Mikrofon nur beim Halten offen, Rauschfilter abschaltbar.

## Bedienung

- Einstellungen → Sprachkanäle: einschalten, Taste wählen (Standard V).
- Am Handy den Mikrofon-Knopf halten.

## Regeln und Grenzen

- Gilt pro Gerät. In Eingabefeldern wirkt die Taste nicht.
- Der Rauschfilter ändert sich ab dem nächsten Beitritt.

## Technik

- `frontend/src/voice/usePushToTalk.ts`, `devices.ts`, `store/prefs.ts`

## Tests

- Nicht automatisch getestet, auch nicht mit echtem Mikrofon
