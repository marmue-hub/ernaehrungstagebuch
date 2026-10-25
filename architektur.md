# Architektur für das Ernährungstagebuch

## 1. Zielbild

Das Projekt ist ein lokales Ernährungstagebuch für das iPhone, das im Heimnetzwerk läuft. Die zentrale Datenhaltung befindet sich auf einem eigenen Server im lokalen LAN. Die App wird als PWA für das iPhone umgesetzt, damit kein Apple-Developer-Account nötig ist. Die Synchronisierung passiert über das lokale WLAN, und die Erinnerungsfunktion basiert auf lokalen Benachrichtigungen im Client statt auf Signal, Messenger oder anderen externen Messaging-Services.

---

## 2. Grundprinzipien

- iPhone-freundlich über Web-App/PWA
- keine Abhängigkeit von Apple App Store oder Entwicklerkonto für die erste Version
- zentrale Datenhaltung auf einem Server im lokalen Netzwerk
- Synchronisierung nur im lokalen WLAN
- einfache, robuste Architektur für einen Einzelbenutzer
- spätere Erweiterbarkeit auf native iOS-App möglich

---

## 3. Empfohlene Gesamtarchitektur

### 3.1 Komponenten

1. Client-App (PWA)
   - Eingabe von Essen und Uhrzeit
   - Vorschlagsliste zuletzt verwendeter Lebensmittel
   - Eingabe von Symptomen
   - Eingabe des Gesamtwohlbefindens
   - Anzeige von Erinnerungen
   - lokale Benachrichtigungen

2. Backend-API
   - verarbeitet und persistiert alle Daten
   - liefert Daten an die App
   - verwaltet Reminder-Zeitpunkte
   - läuft im Docker-Container im lokalen LAN

3. Datenbank
   - zentraler Speicher für alle Einträge
   - startfähig mit SQLite
   - später optionaler Wechsel auf PostgreSQL

4. Synchronisationsschicht
   - Client lädt und sendet Daten an den Server
   - Server ist die Autorität für Daten
   - einfache Polling-Synchronisierung reicht für den MVP

5. Reminder-Service
   - erzeugt Reminder-Zeitpunkte nach dem Essen
   - prüft Fälligkeit
   - löst lokale Benachrichtigung beim Client aus

6. Netzwerk-/Hosting-Layer
   - Server erreichbar unter einer lokalen Domain wie `wiegehts.x73.eu`
   - Route im lokalen Netzwerk auf die LAN-IP des Servers

---

## 4. Technologie-Entscheidung

### Frontend
- React + Vite
- PWA-Funktionen:
  - installierbar auf dem iPhone
  - Service Worker
  - Offline-Speicher
  - Notification-API

### Backend
- Node.js mit Fastify oder Python mit FastAPI
- Empfehlung: FastAPI, weil für eine kleine App klar, schnell und sauber

### Datenbank
- SQLite für den MVP
- einfache lokale Persistenz
- wenig Betriebskomplexität
- gut geeignet für einen Einzelbenutzer und lokale Nutzung

### Serverbetrieb
- Docker Compose
- Container für:
  - API
  - Datenbank
  - optional Reverse Proxy

---

## 5. Architekturdiagramm

```text
+---------------------+
| iPhone / Browser    |
| PWA-App             |
| - Mahlzeit erfassen |
| - Symptom erfassen  |
| - Wohlbefinden      |
| - Reminder UI      |
+----------+----------+
           |
           | HTTPS / LAN / lokale Verbindung
           v
+---------------------+
| Backend API         |
| FastAPI / Node      |
| - CRUD Endpoints    |
| - Reminder-Logik    |
| - Synchronisation   |
+----------+----------+
           |
           v
+---------------------+
| Datenbank           |
| SQLite              |
| Mahlzeiten          |
| Symptome            |
| Wohlbefinden        |
| Reminder            |
+---------------------+
```

---

## 6. Datenmodell

### 6.1 Mahlzeit

- id
- createdAt
- updatedAt
- eatenAt
- name
- notes (optional)
- reminderState

### 6.2 Symptome

- id
- mealId (optional)
- type
  - Bauchweh
  - Übelkeit
  - Kopfschmerzen
- value
  - 1 bis 5
- timestamp

### 6.3 Gesamtwohlbefinden

- id
- value
  - 1 bis 3
- timestamp

### 6.4 Reminder

- id
- mealId
- scheduledAt
- reminderType
  - 1h
  - 4h
- sentAt
- status
  - pending
  - sent
  - dismissed

### 6.5 Vorschlagsliste

- foodName
- usageCount
- lastUsedAt

---

## 7. Fachliche Funktionen und Umsetzung

### 7.1 Essen eingeben

- Nutzer gibt Essen und Uhrzeit ein
- Standardwert ist die aktuelle Uhrzeit
- Eintrag wird an den Server gesendet
- nachträgliche Änderung ist möglich

### 7.2 Essensvorschläge

- beim nächsten Eintrag werden bereits verwendete Lebensmittel vorgeschlagen
- Sortierung nach Häufigkeit und zuletzt verwendet
- dies kann als einfache Historik-Liste realisiert werden

### 7.3 Symptomeingabe

- Symptome: Bauchweh, Übelkeit, Kopfschmerzen
- Skala 1 bis 5
- Speicherung erfolgt mit Zeitstempel

### 7.4 Gesamtwohlbefinden

- 3-Stufen-Skala mit Smilies
- kann als eigenes Formular oder als Teil des Tages- bzw. Mahlzeit-Eintrags modelliert werden

### 7.5 Erinnerungsfunktion

- 1h und 4h nach dem Essen
- beim Speichern des Essens werden Reminder angelegt
- Reminder-Checker prüft Fälligkeit
- relevante Einschätzung:
  - wenn App aktiv ist, Notification anzeigen
  - wenn App im Hintergrund läuft, lokale Browser-Notification anzeigen, soweit vom Browser unterstützt
  - echte Hintergrund-Erinnerungen auf iPhone sind mit PWA nur eingeschränkt möglich

---

## 8. Reminder-Entscheidung: Signal/Messenger oder lokales System?

### Warum Signal/Messenger nicht die beste Lösung ist

- Signal und Messenger sind Endnutzer-Apps, kein allgemeiner Notification-Mechanismus für eine eigene App
- Das Backend müsste einen Messenger-Client oder Bot betreiben
- Für einen privaten lokalen Service ist das unnötig und schwer wartbar
- Es führt zu einer Architektur, die nicht zu dem restlichen System passt

### Empfohlene Lösung

- Das Backend legt Reminder-Zeitpunkte an
- Die App prüft regelmäßig den Server oder den lokalen Cache
- Die App zeigt eine lokale Benachrichtigung an
- Für echte Push-Benachrichtigungen in einer echten iOS-App später über APNs

### Konsequenz

Die Erinnerung ist nicht “vom Backend per Signal ausgelöst”, sondern:

Backend erzeugt Reminder → Client überwacht Fälligkeit → Client zeigt lokale Notification an.

Das ist die sauberste und robusteste Architektur für das vorhandene Szenario.

---

## 9. Synchronisationsmodell

### MVP-Ansatz

- App startet
- App lädt alle neueren Datensätze vom Server
- App sendet lokale Änderungen an den Server
- Server antwortet mit aktuellem Status

### Regelmäßigkeit

- beim Start der App
- nach jeder Eingabe
- im Hintergrund in kurzen Intervallen

### Konfliktbehandlung

Für den Einbenutzerfall genügt:

- letzte Änderung gewinnt
- oder serverseitige Autorität

Da nur ein Nutzer erwartet wird, ist die Konfliktlogik einfach und robust.

---

## 10. Lokales Netzwerk und Domain

### Laufzeitumgebung

- Server läuft im lokalen LAN
- erreichbar über lokale IP oder lokale Domain
- `wiegehts.x73.eu` als logische Domain, die im lokalen Netzwerk auf den Server zeigt

### Betrieb

- Docker Compose für das Hosting
- optional Nginx/Traefik als Reverse Proxy
- HTTPS lokal möglich, aber nicht zwingend notwendig für den MVP

---

## 11. Sicherheit und Betriebsmodell

- nur lokales WLAN als Zielbereich
- keine öffentliche Internet-Exposition nötig
- einfache Authentifizierung für die App genug
- keine Cloud-Dienste nötig
- private Datensammlung im Heimnetzwerk

---

## 12. MVP-Umsetzung in Phasen

### Phase 1: Grundfunktionen
- Essen erfassen
- Uhrzeit erfassen
- Speichern und abrufen
- Vorschlagsliste

### Phase 2: Symptom- und Wohlbefinden-Module
- Symptomeingabe
- 3er Skala mit Smilies
- Speicherung im Backend

### Phase 3: Erinnerungen
- Reminder anlegen
- Prüfung der Fälligkeit
- lokale Benachrichtigung

### Phase 4: Stabilisierung
- UI-Verbesserung
- Fehlermeldungen
- Offline-Support
- Synchronisierung optimieren

### Phase 5: Zukunft
- Native iOS App
- echte Push-Erinnerungen via APNs
- Statistiken und Auswertungen

---

## 13. Fazit

Die beste Architektur für das vorliegende Projekt ist:

- PWA als Frontend auf dem iPhone
- lokaler Server im Heimnetzwerk
- zentrale Datenhaltung in Docker mit SQLite
- Synchronisierung im lokalen WLAN
- Reminder-Mechanik als lokales Client-Notification-System
- keine Nutzung von Signal oder Messenger als Haupt-Mechanismus

Diese Lösung ist für die erste Umsetzung technisch sinnvoll, schnell realisierbar und gut an die Anforderungen in [spec.md](spec.md) angepasst.
