# Deployment

- `deploy.sh`: spielt den aktuellen Stand von `origin/main` per SSH auf dem Server ein.
- `admin-anleitung.md`: Einrichtung, manuelles Update, Checks und Fehlersuche für den Admin.

## Aufruf

```bash
./deployment/deploy.sh <user@host> [remote-dir]
./deployment/deploy.sh admin@wiegehts.x73.eu /opt/ernaehrungstagebuch
```

Ziel und Verzeichnis können auch über `PROD_SSH_TARGET` und `PROD_REMOTE_DIR` gesetzt werden. Standard für das Verzeichnis ist `/opt/ernaehrungstagebuch`.

Voraussetzung: SSH-Zugang zum Server per Schlüssel. Der Server-Benutzer braucht Rechte für `git` im Projektverzeichnis und für `docker compose`.

## Was das Skript prüft

Das Skript bricht ab, statt einen veralteten oder veränderten Stand zu deployen, wenn auf dem Server:

- das Verzeichnis fehlt oder kein Git-Repository ist,
- ein anderer Branch als `main` ausgecheckt ist,
- versionierte Dateien lokal geändert wurden,
- `.env` mit `APP_PASSWORD` fehlt,
- `origin/main` nicht per Fast-Forward übernommen werden kann, z. B. wegen eines eigenen Commits auf dem Server.

Erst danach führt es `docker compose up --build -d` aus und zeigt den Status. Für die Checks nach dem Deploy siehe [admin-anleitung.md](admin-anleitung.md#checks-nach-dem-start).

## Grundregel

Auf dem Server wird nicht entwickelt. Änderungen kommen nur über `main` im GitHub-Repository dorthin.
