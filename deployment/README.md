# Deployment

Dieses Verzeichnis enthält das Deployment-Skript und die Regeln, damit der Server nie wieder mit veraltetem Code deployt.

## Grundregel

Vor jedem Deploy und vor jeder größeren Änderung gilt:

- immer zuerst auf main wechseln
- immer zuerst den aktuellen Stand von origin laden
- niemals auf einem lokalen, veralteten Checkout weiterarbeiten
- niemals uncommittete Änderungen in das Produktiv-Repo deployen

## Ablauf

Auf dem Server im Zielverzeichnis:

```bash
cd /opt/ernaehrungstagebuch
git fetch --all --prune
git checkout main
git diff --quiet && git diff --cached --quiet
git pull --ff-only origin main
docker compose up --build -d
docker compose ps
```

## Skript

```bash
chmod +x deploy.sh
./deploy.sh deploy@wiegehts.x73.eu /opt/ernaehrungstagebuch
```

Das Skript prüft jetzt explizit:

- ob das Repository auf main steht
- ob der Arbeitsbaum sauber ist
- ob der aktuelle Stand aus origin geladen wird
- ob ein Fast-Forward-Update möglich ist

Falls ein Zustand nicht sauber ist, bricht das Deployment ab, statt mit veralteter Software weiterzumachen.

## Warum das wichtig ist

Wenn der Admin eine ältere Version deployt, liegt das typischerweise daran, dass:

- ein anderer Branch aktiv ist
- ein veraltetes Repo verwendet wird
- das Produktiv-Verzeichnis nicht sauber ist
- ein alter Docker-Stack weiterläuft

## Verifikation

Nach dem Deploy sollte der Admin prüfen:

```bash
git -C /opt/ernaehrungstagebuch log -1 --oneline
git -C /opt/ernaehrungstagebuch status --short --branch
docker compose ps
docker compose logs --tail=100 backend frontend
```

Damit kann man sicherstellen, dass nicht nur das aktuelle Git-Projekt auf dem Server liegt, sondern auch wirklich der richtige Branch und der aktuelle Commit läuft.
