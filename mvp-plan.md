# MVP-Umsetzungsplan für das Ernährungstagebuch

## 1. Ziel des MVP

Der MVP soll die zentralen Kernfunktionen bereitstellen:

- Essen mit Uhrzeit erfassen
- nachträglich bearbeiten
- Essensvorschläge anzeigen
- Symptome erfassen
- Gesamtwohlbefinden erfassen
- Reminder für 1h und 4h
- lokale Synchronisierung im WLAN

Das Ziel ist ein lauffähiges, nutzbares System auf einem lokalen Server und einer iPhone-freundlichen PWA.

---

## 2. Umsetzung in Phasen

### Phase 1: Projektstruktur und Basis-Setup

#### Aufgaben
- Ordnerstruktur definieren
- Git-Repository einrichten
- Backend-Setup vorbereiten
- Frontend-Setup vorbereiten
- Docker-Compose für lokale Ausführung erstellen

#### Ergebnis
- lauffähige Entwicklungsumgebung
- Basis für API und App vorhanden

---

### Phase 2: Backend mit zentraler Datenhaltung

#### Aufgaben
- API-Server aufsetzen
- SQLite-Datenbank einrichten
- CRUD-Endpunkte für Mahlzeiten erstellen
- CRUD-Endpunkte für Symptome erstellen
- CRUD-Endpunkte für Wohlbefinden erstellen
- Reminder-Model und Logik definieren

#### Ergebnis
- Daten können zentral gespeichert werden
- App kann mit dem Backend kommunizieren

---

### Phase 3: PWA-Frontend

#### Aufgaben
- Grundlayout der App erstellen
- Seiten oder Views für:
  - Mahlzeit erfassen
  - Symptome erfassen
  - Wohlbefinden erfassen
  - Übersicht
- Formularvalidierung einbauen
- lokale Speicherung / Synchronisierung mit Backend implementieren
- Vorschlagsliste für zuletzt genutzte Essensnamen zeigen

#### Ergebnis
- Nutzer kann Mahlzeiten und Symptome im Frontend vollständig eingeben
- Daten werden in das System übertragen

---

### Phase 4: Reminder-Funktion

#### Aufgaben
- beim Anlegen einer Mahlzeit Reminder erzeugen
- 1h- und 4h-Zeitpunkte berechnen
- Reminder-Scheduler einbauen
- Benachrichtigungen im Frontend auslösen
- Zustandsänderungen in der Datenbank speichern

#### Ergebnis
- Erinnerung wird zeitlich korrekt ausgelöst
- Nutzer erhält Benachrichtigung im Rahmen der App bzw. des Browsers

---

### Phase 5: Synchronisierung und Stabilisierung

#### Aufgaben
- App startet Datenabruf
- Änderungen können synchronisiert werden
- Fehlerbehandlung und Ladezustände ergänzen
- lokale Validierung der Eingaben verbessern
- einfache Wiederholungs- und Fallback-Logik einbauen

#### Ergebnis
- ein stabiler MVP mit konsistenter Datenhaltung

---

### Phase 6: Deployment im lokalen Netzwerk

#### Aufgaben
- Docker Container starten
- Domain- oder LAN-Adressierung konfigurieren
- lokale Verfügbarkeit testen
- iPhone-Zugriff über WLAN prüfen

#### Ergebnis
- App kann im lokalen Netzwerk genutzt werden

---

## 3. Reihenfolge der Implementierung

Die Reihenfolge ist wichtig, damit keine falschen Abhängigkeiten entstehen:

1. Backend und Datenmodell aufbauen
2. Datenbankstruktur und API-Endpunkte implementieren
3. Frontend mit Grundfunktionen entwickeln
4. Synchronisierung zwischen Frontend und Backend einbauen
5. Reminder-Logik ergänzen
6. lokale Laufzeit und Deployment prüfen

---

## 4. Prioritäten nach Wichtigkeit

### Hohe Priorität
- Essen erfassen
- Uhrzeit erfassen
- lokale Datenhaltung
- Synchronisierung
- Reminder für 1h und 4h

### Mittlere Priorität
- Symptomeingabe
- Wohlbefinden
- Vorschlagsliste

### Niedrige Priorität
- UI-Politur
- Zusatzstatistiken
- erweiterte Filter
- zusätzliche Visualisierungen

---

## 5. Technische Annahmen für den MVP

- ein Benutzer
- lokales Netzwerk
- kein Mehrbenutzer-Management
- zentrale Datenspeicherung auf Server
- keine öffentliche Internetverbindung erforderlich
- PWA statt native iOS-App
- Reminder als lokale Benachrichtigung im Browser/Client

---

## 6. Definition of Done für den MVP

Der MVP gilt als abgeschlossen, wenn:

- eine Mahlzeit gespeichert werden kann
- die Uhrzeit korrekt erfasst wird
- Symptome eingegeben und gespeichert werden
- Gesamtwohlbefinden eingegeben und gespeichert werden
- nachfolgende Essensvorschläge angezeigt werden
- Reminder für 1h und 4h angelegt werden
- die App im lokalen WLAN mit dem Server kommuniziert
- Daten konsistent gespeichert werden

---

## 7. Ergebnis der MVP-Planung

Der MVP ist auf den Kernwert fokussiert:

- einfache Bedienung
- robustes lokales Setup
- zentrale Datenspeicherung
- funktionierende Erinnerung
- keine unnötige Komplexität

Das ist die beste Grundlage für eine später mögliche native iOS-Version.
