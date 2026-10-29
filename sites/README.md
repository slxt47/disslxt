# disslxt – Produktseite und Hilfe

Zwei statische Seiten ohne Build-Schritt, je ein gehärteter nginx-Container:

| Ordner    | Inhalt                                                 | Lokal                   | Öffentlich (Tunnel)              |
| --------- | ------------------------------------------------------ | ----------------------- | -------------------------------- |
| `web/`    | Produktseite, Impressum, Datenschutzerklärung          | `http://127.0.0.1:8092` | `https://disslxt-info.slxt.org`  |
| `hilfe/`  | Hilfe für neue Nutzer (Suche, alle Funktionen)         | `http://127.0.0.1:8093` | `https://disslxt-hilfe.slxt.org` |
| `shared/` | gemeinsames Stylesheet, Skript und Icons (unter `/_/`) |                         |                                  |

Starten / nach Änderungen an `deploy/nginx.conf` neu laden:

```sh
cd sites && docker compose up -d          # Inhalte sind direkt eingebunden: HTML ändern genügt
```

## DSGVO

- Keine Cookies, kein Tracking, keine Zugriffsprotokolle (`access_log off`, 404 nicht protokolliert).
- Nur eigene Dateien: keine Google Fonts, CDNs oder Einbettungen; die CSP (`default-src 'none'`)
  verhindert, dass versehentlich etwas Fremdes geladen wird.
- Impressum und Datenschutzerklärung in `web/`; die App verlinkt sie (`frontend/src/components/LegalLinks.tsx`).
- Gelb markierte Stellen (`class="todo"`) in `impressum.html` und `datenschutz.html` müssen vor dem
  Veröffentlichen mit den echten Angaben gefüllt werden.

## Andere Adressen

Die Adressen stehen in den HTML-Dateien und in `LegalLinks.tsx`. Ändern mit
`grep -rl disslxt-info.slxt.org sites frontend/src | xargs sed -i 's/disslxt-info.slxt.org/NEU/g'`
(ebenso für `disslxt-hilfe.slxt.org`).
