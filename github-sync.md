# GitHub-Synchronisierung und Deployment-Workflow

## 1. Ziel

Die Anwendung soll nach Änderungen immer in einem GitHub-Repository synchronisiert werden. Das Repository dient dabei als zentraler Code- und Versionsspeicher für die Entwicklung.

Wichtig:
- GitHub synchronisiert den Quellcode
- GitHub synchronisiert nicht die Nutzerdaten der App
- die Laufzeitdaten bleiben auf dem lokalen Server in der Datenbank

---

## 2. Architektur-Entscheidung

### GitHub ist für:
- Source Code
- Konfigurationsdateien
- Deployment-Skripte
- Dokumentation
- Branches und Pull Requests

### Der lokale Server ist für:
- Datenbank
- Backend-API
- App-Assets
- laufende Anwendung

---

## 3. Workflow

### Standardablauf

1. Entwickler arbeitet lokal am Code
2. Änderungen werden committed
3. Änderungen werden auf GitHub gepusht
4. GitHub dient als zentraler Backup-/Versionsspeicher
5. optional: Server zieht die Änderungen automatisch per Git oder CI/CD

---

## 4. Empfohlener Git-Workflow

### Branches
- `main` = stabile Version
- `develop` = aktive Entwicklung
- `feature/*` = einzelne Features

### Praktisch für den MVP
- direkt im `main` arbeiten, wenn nur ein Entwickler beteiligt ist
- bei größeren Änderungen `feature/*` nutzen

---

## 5. Synchronisierung zum GitHub-Account

### Lokaler Commit und Push

```bash
git status
git add .
git commit -m "Beschreibung der Änderung"
git push origin main
```

So werden alle Änderungen immer auf GitHub synchronisiert.

---

## 6. Deployment vom GitHub auf den Server

Da der Server im lokalen LAN läuft, ist eine einfache und robuste Lösung:

### Option A: Git-Pull auf dem Server
- Repo auf dem Server klonen
- per SSH oder GitHub-Actions auf den Server deployen
- dort `git pull` ausführen

### Option B: GitHub Actions
- bei Push auf `main` wird ein Workflow gestartet
- Workflow verbindet sich mit dem Server
- Server zieht neue Versionen per SSH
- Container werden neu gebaut und gestartet

### Empfehlung für dieses Projekt

Für den MVP ist die Kombination aus:
- GitHub als Versionskontrolle
- Server-Deployment via GitHub Actions oder SSH-Deploy

am sinnvollsten.

---

## 7. Beispiel-Deployment-Setup

### Server-Ordner

```text
/home/ernaehrungstagebuch/
  app/
  docker/
  .git/
```

### Server-Strategie

- GitHub enthält den aktuellen Code
- Server hält die laufende Instanz lokal
- bei Änderungen:
  - `git pull` im Server-Verzeichnis
  - Docker-Container neu bauen
  - Services neu starten

---

## 8. Was nicht auf GitHub gehört

Nicht auf GitHub synchronisieren sollten:
- Nutzer- und App-Daten
- lokale Datenbankinhalte
- Laufzeit-Logs
- vom Benutzer eingegebene Ernährungsdaten

Diese liegen auf dem lokalen Server und bleiben dort.

---

## 9. Empfehlung für die Umsetzung

### Für das aktuelle Projekt

- GitHub-Repository anlegen
- alle Codeänderungen dort pushen
- GitHub als zentralen Versionsspeicher nutzen
- optional GitHub Actions einbauen, damit der Server nach einem Push automatisch aktualisiert wird

### Ergebnis

- immer nachvollziehbar, welche Änderungen gemacht wurden
- Backup und Versionskontrolle vorhanden
- einfacher Wechsel zwischen Entwicklungszuständen

---

## 10. Kurzfassung

Ja, das passt sehr gut zur Architektur:

- GitHub = Quellcode-Versionierung und Synchronisierung
- lokaler Server = laufende App und Datenhaltung
- Deployment = automatisch oder per Pull nach Änderungen

Das ist der passende und saubere Ansatz für dein Projekt.
