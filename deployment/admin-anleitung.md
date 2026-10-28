# Deployment-Anleitung für den Netzwerk-Admin

Hallo,

die App „Ernährungstagebuch“ läuft im Heimnetz als PWA, vor allem auf dem iPhone. Sie arbeitet offline-first. Unterwegs werden Einträge lokal auf dem Gerät gespeichert. Sobald das Gerät wieder im Heimnetz ist, überträgt die App sie an den Server.

## Überblick

- **Adresse:** `https://wiegehts.x73.eu`. Sie zeigt auf `192.168.111.10` (`hermes.x73.eu`) und ist nur im Heimnetz erreichbar. Das ist gewollt: Die App erkennt das Heimnetz genau daran, dass diese Adresse erreichbar ist.
- **Container (Docker Compose):**
  - `frontend`: React-PWA, Produktions-Build, Port 5173
  - `backend`: FastAPI, Port 8000
  - `postgres`: PostgreSQL 16
- **Reverse Proxy:** leitet `/api/` an das Backend und alles andere an das Frontend weiter. Eine Beispielkonfiguration liegt in `nginx/ernaehrungstagebuch.conf`.
- **Ports:** Alle Ports sind nur an `127.0.0.1` gebunden, also nur über den Reverse Proxy erreichbar.
- **Anmeldung:** Die App ist durch ein gemeinsames App-Passwort geschützt.

## Voraussetzungen

- **Docker und Docker Compose**
- **Feste LAN-IP** für den Server, oder eine DHCP-Reservierung
- **DNS:** `wiegehts.x73.eu` zeigt auf die Server-IP.
- **HTTPS mit gültigem Zertifikat ist Pflicht.** Service Worker, also der Offline-Modus, und die Installation als App auf dem iPhone funktionieren nur über HTTPS.

## Einmalige Einrichtung

1. Repository klonen:

   ```bash
   git clone https://github.com/marmue-hub/ernaehrungstagebuch.git /opt/ernaehrungstagebuch
   cd /opt/ernaehrungstagebuch
   ```

2. App-Passwort hinterlegen. Ohne diese Datei startet `docker compose` nicht, sondern bricht mit „APP_PASSWORD fehlt“ ab. Das Passwort bekommst du getrennt, nicht per Mail oder Chat.

   ```bash
   read -rs -p 'App-Passwort: ' P && printf 'APP_PASSWORD=%s\n' "$P" > .env && chmod 600 .env && unset P
   ```

   - `.env` liegt neben `docker-compose.yml` und ist in `.gitignore` eingetragen. Sie stört weder `git pull` noch das Deploy-Skript.
   - Wird das Passwort später geändert, werden alle Geräte abgemeldet. Danach den Backend-Container neu starten: `docker compose up -d backend`.

3. Container starten:

   ```bash
   docker compose up --build -d
   ```

   Das Frontend baut die App beim Start. Die Seite ist deshalb erst nach etwa 30–60 Sekunden erreichbar.

## Aktualisierung

Bitte immer über `main` und nur per Fast-Forward. Lokale Änderungen auf dem Server führen zum Abbruch, damit nichts Veraltetes deployt wird.

```bash
cd /opt/ernaehrungstagebuch
git status --short --branch     # muss "## main...origin/main" zeigen, sonst keine Zeilen
git fetch --prune origin
git merge --ff-only origin/main
docker compose up --build -d
docker compose ps
```

Zeigt `git status` einen anderen Branch oder geänderte Dateien, bitte nicht deployen, sondern Rücksprache halten.

Dasselbe erledigt per SSH das Skript `deployment/deploy.sh <user@host> /opt/ernaehrungstagebuch`. Es bricht in diesen Fällen von selbst ab und prüft zusätzlich, ob die `.env` vorhanden ist.

Vor größeren Updates bitte die Datenbank sichern:

```bash
docker compose exec -T postgres pg_dump -U app ernahrungstagebuch > ~/ernaehrungstagebuch-backup-$(date +%F).sql
```

## Checks nach dem Start

```bash
docker compose ps
curl -s https://wiegehts.x73.eu/health                                    # {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' https://wiegehts.x73.eu/api/users  # 401 = Anmeldung aktiv
curl -s -o /dev/null -w '%{http_code}\n' https://wiegehts.x73.eu/docs       # 404 = API-Doku in Produktion aus
```

Danach die App im Browser öffnen. Es sollte die Anmeldeseite erscheinen.

## Fehlersuche

- **Logs:** `docker compose logs --tail=100 backend frontend`
- **„APP_PASSWORD fehlt“:** Die `.env` fehlt oder liegt im falschen Verzeichnis, siehe Einrichtung, Schritt 2.
- **Backend meldet „Permission denied“:** Der Backend-Container läuft nicht als root, sondern als UID 10001. Weil `./backend` als Volume eingebunden ist, müssen die Dateien dort für alle lesbar sein. Bei einem normalen `git clone` ist das so, bei einer strengen umask (z. B. 027) nicht. Abhilfe: `chmod -R o+rX backend`.
- **Seite bleibt kurz nach dem Start leer:** Das Frontend baut noch. Bitte etwa eine Minute warten.

## Hinweise zur Sicherheit

- Die App ist nicht für das öffentliche Internet gedacht. Bitte keine Portfreigabe im Router einrichten.
- **Datenbank-Passwort:** In `docker-compose.yml` steht als Datenbank-Passwort `secret`. PostgreSQL ist nur über `127.0.0.1` und im Docker-Netz erreichbar. Wer es ändern möchte, muss es zusätzlich in der bestehenden Datenbank anpassen (`ALTER USER app PASSWORD '...'`).
- **Fehlversuche:** Nach 10 falschen Anmeldungen innerhalb von 15 Minuten sperrt das Backend weitere Anmeldungen für 15 Minuten.

Vielen Dank!
