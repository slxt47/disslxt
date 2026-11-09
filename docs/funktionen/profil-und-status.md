# Profil, Status und Abzeichen

[Alle Funktionen](README.md)

Wie du für andere erscheinst.

## Bedienung

- Einstellungen → Profil: Anzeigename, Bild, Status, Abzeichen.
- Tipp auf einen Namen öffnet das Profil.

## Regeln und Grenzen

- Status bis 80 Zeichen. Bis zu 3 Abzeichen.
- Punkt am Bild: grün online, rot im Anruf, grau offline.

## Technik

- `backend/src/services/user.service.ts`, `badge.service.ts`
- Event `user.updated`
- `components/ProfileSettings.tsx`, `ProfileDialog.tsx`

## Tests

- `backend/test/social.test.ts`
- `e2e/tests/account-status.spec.ts`, `presence.spec.ts`
