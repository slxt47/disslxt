# disslxt – Vorgabe (aus der HTML des Nutzers übernommen)

Communities, Server, Kanäle, Echtzeit.

## Vision
Eine schlanke Chat-Plattform für Communities: Nutzer treten Servern bei, Server haben Textkanäle, Nachrichten kommen in Echtzeit an.

## MVP-Ziel
Nutzer können sich registrieren, einem Server beitreten und in Textkanälen in Echtzeit miteinander chatten.

## In Scope
- Accounts: Registrierung, Login (E-Mail + Passwort), Logout
- Server: erstellen, per Invite-Link beitreten, verlassen
- Channels: Textkanäle pro Server anlegen und anzeigen
- Nachrichten: senden, anzeigen, älteren Verlauf nachladen, eigene bearbeiten und löschen
- Echtzeit: neue Nachrichten erscheinen ohne Reload (WebSocket)
- Präsenz: einfacher Online/Offline-Status pro Server
- Web-Client: responsiv, im Browser nutzbar

## Nicht im MVP
Voice/Video, Bots & API, DMs, Threads, Reactions, Dateianhänge, feine Rollen, Push, Mobile Apps, E-Mail-Verifizierung, Moderation

## Nicht-funktional
- Nachrichtenzustellung unter 300 ms im lokalen Netz
- Ziel: 100 gleichzeitige Nutzer pro Instanz
- Passwörter nur gehasht (argon2 oder bcrypt)
- Keine Secrets im Repository, Konfiguration über Env-Variablen
- Tests für Auth und Nachrichtenlogik

## Tech-Vorschlag
- Backend: Node.js, TypeScript, Fastify oder Express, ws
- Datenbank: PostgreSQL mit Prisma oder Drizzle
- Frontend: React mit Vite (alternativ Svelte)
- Deployment: Docker Compose

## Erfolgskriterien
1. Zwei Nutzer in zwei Fenstern chatten in Echtzeit.
2. Ein neuer Nutzer tritt über einen Invite-Link bei.
3. Der Verlauf bleibt nach einem Reload erhalten.

## Offene Fragen
- Ist „Discord“ nur ein Arbeitstitel? (Markenrecht)
- Self-hosted oder Cloud?
- Dürfen Gäste ohne Account lesen?

## To-do

### Phase 0 – Setup
- Git-Repo, `.gitignore`
- Monorepo: `backend/`, `frontend/`, `shared/`
- TypeScript, ESLint, Prettier
- `docker-compose.yml` mit PostgreSQL
- `.env.example` und README

### Phase 1 – Backend-Basis
- DB-Schema und Migrationen
- Auth: Registrierung, Login, Session oder JWT
- Guilds: erstellen, auflisten, beitreten, verlassen
- Channels pro Guild
- Messages: senden, paginiert laden, bearbeiten, löschen
- Autorisierung: nur Mitglieder
- Tests für Auth und Nachrichten

### Phase 2 – Echtzeit
- WebSocket mit Auth beim Verbindungsaufbau
- Rooms pro Channel
- Events: created, updated, deleted
- Präsenz pro Guild

### Phase 3 – Frontend
- Login und Registrierung
- Layout: Serverliste, Channels, Chatfenster
- Nachrichtenliste mit Auto-Scroll und „Ältere laden“
- Eingabe: Enter sendet, Shift+Enter Zeilenumbruch
- Bearbeiten und Löschen eigener Nachrichten
- Invite-Seite, Reconnect, Mobile-Layout

### Phase 4 – Qualität und Release
- Rate-Limits auf Login und Senden
- Input-Validierung, XSS-Schutz
- Error-Handling und Logging
- End-to-End-Test mit zwei Clients
- Docker-Deployment mit HTTPS

## Definition of Done
- Läuft lokal per `docker compose up`, ist in der README beschrieben.
- Relevante Tests sind grün.
- Die Erfolgskriterien aus dem Ziel sind erfüllt.

## Backlog
Rollen, Reactions & Threads, Dateianhänge, DMs, Voice
