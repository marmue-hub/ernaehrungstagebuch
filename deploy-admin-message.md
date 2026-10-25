# Deployment-Anleitung für den Netzwerk-Admin

Hallo,

wir möchten die App im Heimnetzwerk betreiben. Die Anwendung soll im lokalen WLAN als PWA auf dem iPhone erreichbar sein und dabei lokal-first arbeiten: Wenn das Gerät nicht im LAN ist, werden Einträge lokal im Browser gespeichert und bei späterer Wiederverbindung synchronisiert.

## Ziel

- App erreichbar unter: `wiegehts.x73.eu`
- Server läuft im lokalen Netzwerk
- Frontend, Backend und Datenbank laufen als Docker-Container
- keine öffentliche Internet-Veröffentlichung nötig
- lokale LAN-Verfügbarkeit ist der Hauptfall; außerhalb des LANs bleibt die App nutzbar, die Daten werden gecacht und später synchronisiert

## Anforderungen an das Server-Gerät

- Docker und Docker Compose installiert
- feste LAN-IP oder DHCP-Reservierung
- Zugriff per SSH oder Terminal
- keine besondere Hardware erforderlich

## Repository

Das Projekt liegt hier:

- https://github.com/marmue-hub/ernaehrungstagebuch

Der aktuelle Stand im Repository enthält das vollständige Docker-Setup für Frontend, Backend und Datenbank sowie die lokale PWA-/Sync-Logik.

## Was auf dem Server laufen soll

Die Anwendung besteht aus:

- Frontend: React/PWA
- Backend: FastAPI
- Datenbank: PostgreSQL (lokal im Container)
- optional Reverse Proxy / lokale Domain-Routing

Die App ist bewusst so aufgebaut, dass sie im Heimnetzwerk als lokale Service-Anwendung funktioniert und nicht als öffentliche Web-App im Internet.

## Domain / Netzwerk

Bitte die Domain lokal im Heimnetzwerk auf die Server-IP verweisen, z. B.:

- `wiegehts.x73.eu -> 192.168.178.42`

Falls im Router oder lokalen DNS ein Eintrag gesetzt werden kann, bitte entsprechend konfigurieren.

Wenn es nur eine lokale DNS-Auflösung im Heimnetz gibt, reicht ebenfalls eine feste LAN-IP und ein lokaler Hostname/Eintrag im Router oder DNS-Server.

## Einmalige Einrichtung auf dem Server

1. Repository klonen:

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/marmue-hub/ernaehrungstagebuch.git /opt/ernaehrungstagebuch
cd /opt/ernaehrungstagebuch
```

2. Container starten:

```bash
docker compose up --build -d
```

3. Status prüfen:

```bash
docker compose ps
```

4. Logs prüfen, falls etwas nicht läuft:

```bash
docker compose logs -f
```

## Aktualisierung nach Änderungen im Repository

Falls neue Änderungen im GitHub-Repository vorliegen, auf dem Server einfach aktualisieren:

```bash
cd /opt/ernaehrungstagebuch
git pull origin main
docker compose up --build -d
```

Falls die App nur lokal gebaut werden soll und keine neue GitHub-Version vorhanden ist, kann auch der aktuelle Repository-Stand direkt per Git-Update übernommen werden.

## Vorgehensweise, falls der Admin nur den Container bereitstellen soll

Falls der Server-Host nur als Laufzeitumgebung bereitgestellt wird und ich die Container nicht direkt per GitHub pull deployen kann, kann ich auch ein fertiges Docker-Setup bereitstellen. In diesem Fall braucht der Admin im Wesentlichen nur:

- Docker + Docker Compose auf dem Gerät installiert
- das Projekt-Verzeichnis auf dem Host
- die passende Domain bzw. LAN-IP-Konfiguration

Dann genügt der Start mit:

```bash
docker compose up --build -d
```

## Verhalten der App

- Frontend erreichbar über die lokale Domain
- Backend API läuft intern im Docker-Netzwerk
- PostgreSQL läuft lokal im Container
- Die PWA funktioniert auch außerhalb des LANs so weit wie möglich, indem Einträge lokal im Browser zwischengespeichert werden
- sobald das Gerät wieder im Heimnetzwerk ist oder der Nutzer manuell synchronisiert, werden die Einträge an den Server übertragen

## Wichtig

Es geht hier um lokale Verfügbarkeit im WLAN und nicht um eine öffentliche Internet-Website. Eine Freigabe außerhalb des Heimnetzes ist nicht erforderlich, solange die App im LAN genutzt wird.

## Checks nach dem Start

Die zentrale Überprüfung ist:

```bash
docker compose ps
docker compose logs --tail=100
```

Dann die App im Browser über die lokale Domain öffnen, z. B.: `http://wiegehts.x73.eu` oder direkt über die LAN-IP.

Wenn die App nicht erreichbar ist, bitte kurz die Docker-Logs ansehen und dann mit mir abgleichen.

Vielen Dank.
