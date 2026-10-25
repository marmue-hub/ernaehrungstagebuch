# Ernährungstagebuch

Eine lokale iPhone-freundliche PWA mit React Frontend, FastAPI Backend und PostgreSQL-Datenbank.

## Stack

- Frontend: React + Vite
- Backend: FastAPI
- Datenbank: PostgreSQL
- Reverse Proxy: Nginx (server-side, admin-konfiguriert)
- Deployment: Docker Compose

## Lokale Entwicklung

Für die lokale Entwicklung bleibt der direkte Zugriff ohne Caddy aktiv. Das bedeutet:

```bash
docker compose up --build
```

Danach erreichbar:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/docs

Im Heimnetzwerk bzw. auf dem Server wird die externe Route über Nginx abgewickelt, z. B. über die von dem Admin bereits gepflegte Domain-Konfiguration.

## GitHub

Repository vorbereiten:

```bash
git init
git branch -M main
git remote add origin https://github.com/marmue-hub/ernaehrungstagebuch.git
```

Dann:

```bash
git add .
git commit -m "Initial project setup"
git push -u origin main
```

## Wichtige Hinweise

- GitHub enthält nur den Quellcode und Konfigurationen.
- Nutzerdaten bleiben lokal in der PostgreSQL-Datenbank auf dem Server.
- Für lokale Domain-Zugriff muss ggf. ein Eintrag in der Hosts-Datei gesetzt werden.

## MVP-Funktionen

- Essen und Uhrzeit erfassen
- Symptome erfassen (Bauchweh, Übelkeit, Kopfschmerzen)
- Gesamtwohlbefinden erfassen
- 1h und 4h Reminder
- Essensvorschläge basierend auf bisherigen Einträgen
- CSV-Export/Import
