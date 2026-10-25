# Deployment-Anleitung für den Netzwerk-Admin

Hallo,

wir möchten eine lokale Web-App im Heimnetzwerk betreiben. Die App soll über das lokale WLAN erreichbar sein und als PWA auf dem iPhone laufen.

## Ziel

- App erreichbar unter: `wiegehts.x73.eu`
- Server läuft im lokalen Netzwerk
- Frontend, Backend und PostgreSQL laufen lokal als Docker-Container
- keine öffentliche Internet-Veröffentlichung nötig

## Anforderungen an das Server-Gerät

- Docker und Docker Compose installiert
- feste LAN-IP oder DHCP-Reservierung
- Zugriff per SSH oder Terminal
- keine besondere Hardware erforderlich

## Repository

Das Projekt liegt hier:

- https://github.com/marmue-hub/ernaehrungstagebuch

Der bekannte Fehler mit dem fehlenden Frontend-Dockerfile wurde bereits behoben. Der aktuelle Stand im Repository ist entsprechend angepasst.

## Domain / Netzwerk

Bitte die Domain lokal im Heimnetzwerk auf die Server-IP verweisen, z. B.:

- `wiegehts.x73.eu -> 192.168.178.42`

Falls im Router oder lokalen DNS ein Eintrag gesetzt werden kann, bitte entsprechend konfigurieren.

## Vorgehen auf dem Server

1. Repository klonen oder aktualisieren:

```bash
git clone https://github.com/marmue-hub/ernaehrungstagebuch.git /opt/ernaehrungstagebuch
cd /opt/ernaehrungstagebuch
```

2. Container starten:

```bash
docker compose up --build -d
```

3. Optional: Status prüfen:

```bash
docker compose ps
```

4. Danach sollte die App lokal unter der Domain erreichbar sein.

## Verhalten

- Frontend: lokal im Browser erreichbar
- Backend API: interne Service-Verbindung im Docker-Netzwerk
- PostgreSQL: läuft lokal im Container
- Domain: lokal über das Heimnetz erreichbar

## Wichtig

Es geht hier um lokale Verfügbarkeit im WLAN, nicht um eine öffentliche Internet-Website.

Falls die App nach dem Start nicht erreichbar ist, bitte einfach die Logs prüfen:

```bash
docker compose logs -f
```

Vielen Dank.
