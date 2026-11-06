# App installieren

[Alle Funktionen](README.md)

disslxt läuft ohne App Store wie eine App.

## Bedienung

- iPhone: Teilen → Zum Home-Bildschirm. Android und Computer: Installieren im Browser.

## Regeln und Grenzen

- HTTPS ist Pflicht.

## Technik

- PWA mit Manifest und Service Worker, der nie `/api` oder `/ws` cacht

## Tests

- `e2e/tests/pwa-push.spec.ts`, `mobile.spec.ts`
