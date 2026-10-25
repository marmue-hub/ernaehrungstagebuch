# API-Spezifikation für das Ernährungstagebuch

## 1. Überblick

Die API dient als zentrale Datenquelle für die PWA und den lokalen Server im Heimnetzwerk. Sie verwaltet Essenseinträge, Symptome, Wohlbefinden und Reminder. Die API läuft lokal im LAN und ist für einen Einzelbenutzer ausgelegt.

Basis:
- Host: `http://wiegehts.x73.eu` oder lokale LAN-IP
- Protokoll: HTTP/JSON
- Authentifizierung: einfache lokale Authentifizierung per Token oder Shared Secret, je nach Deployment

---

## 2. Allgemeine Konventionen

### 2.1 JSON-Format

Alle Requests und Responses sind JSON.

### 2.2 Timestamps

Zeitstempel im ISO-8601-Format:

```json
"2026-10-25T12:00:00Z"
```

### 2.3 Fehlerformat

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Essen ist erforderlich"
  }
}
```

### 2.4 Erfolgsstatus

- `200 OK` bei erfolgreichen GET/PUT
- `201 Created` bei erfolgreichem POST
- `204 No Content` bei erfolgreichem DELETE
- `400 Bad Request` bei ungültigen Eingaben
- `404 Not Found` bei fehlenden Ressourcen
- `500 Internal Server Error` bei Serverfehlern

---

## 3. Ressourcen

### 3.1 Mahlzeiten

#### `GET /api/meals`

Gibt alle Mahlzeiten zurück.

Response:

```json
[
  {
    "id": "meal_123",
    "name": "Kartoffeln mit Gemüse",
    "eatenAt": "2026-10-25T12:30:00Z",
    "createdAt": "2026-10-25T12:31:00Z",
    "updatedAt": "2026-10-25T12:31:00Z",
    "notes": "etwas salziger als erwartet",
    "reminderState": "pending"
  }
]
```

#### `POST /api/meals`

Legt eine neue Mahlzeit an.

Request:

```json
{
  "name": "Kartoffeln mit Gemüse",
  "eatenAt": "2026-10-25T12:30:00Z",
  "notes": "etwas salziger als erwartet"
}
```

Response:

```json
{
  "id": "meal_123",
  "name": "Kartoffeln mit Gemüse",
  "eatenAt": "2026-10-25T12:30:00Z",
  "createdAt": "2026-10-25T12:31:00Z",
  "updatedAt": "2026-10-25T12:31:00Z",
  "notes": "etwas salziger als erwartet",
  "reminderState": "pending"
}
```

#### `PUT /api/meals/:id`

Aktualisiert eine bestehende Mahlzeit.

Request:

```json
{
  "name": "Kartoffeln mit Gemüse",
  "eatenAt": "2026-10-25T12:45:00Z",
  "notes": "jetzt korrigiert"
}
```

#### `DELETE /api/meals/:id`

Löscht eine Mahlzeit und zugehörige Reminder/Einträge.

---

### 3.2 Symptome

#### `GET /api/symptoms`

Gibt alle Symptome zurück.

Response:

```json
[
  {
    "id": "symptom_001",
    "mealId": "meal_123",
    "type": "bauchweh",
    "value": 3,
    "timestamp": "2026-10-25T13:10:00Z"
  }
]
```

#### `POST /api/symptoms`

Request:

```json
{
  "mealId": "meal_123",
  "type": "bauchweh",
  "value": 3,
  "timestamp": "2026-10-25T13:10:00Z"
}
```

Response:

```json
{
  "id": "symptom_001",
  "mealId": "meal_123",
  "type": "bauchweh",
  "value": 3,
  "timestamp": "2026-10-25T13:10:00Z"
}
```

Validierung:
- `type` muss einer der Werte sein: `bauchweh`, `uebelkeit`, `kopfschmerzen`
- `value` muss zwischen 1 und 5 liegen

---

### 3.3 Gesamtwohlbefinden

#### `GET /api/wellbeing`

Response:

```json
[
  {
    "id": "wellbeing_001",
    "value": 2,
    "timestamp": "2026-10-25T19:00:00Z"
  }
]
```

#### `POST /api/wellbeing`

Request:

```json
{
  "value": 2,
  "timestamp": "2026-10-25T19:00:00Z"
}
```

Validierung:
- `value` muss 1, 2 oder 3 sein

---

### 3.4 Reminder

#### `GET /api/reminders`

Gibt alle Reminder zurück.

Response:

```json
[
  {
    "id": "reminder_001",
    "mealId": "meal_123",
    "scheduledAt": "2026-10-25T13:30:00Z",
    "reminderType": "1h",
    "status": "pending"
  }
]
```

#### `POST /api/reminders`

Wird in der Regel durch das Backend beim Speichern einer Mahlzeit automatisch erstellt.

Request:

```json
{
  "mealId": "meal_123",
  "scheduledAt": "2026-10-25T13:30:00Z",
  "reminderType": "1h"
}
```

#### `PUT /api/reminders/:id`

Status aktualisieren:

```json
{
  "status": "sent",
  "sentAt": "2026-10-25T13:31:00Z"
}
```

---

## 4. Reminder-Logik

Beim Anlegen einer Mahlzeit werden automatisch Reminder erzeugt:

- 1 Stunde nach Essen
- 4 Stunden nach Essen

Beispiel:

```json
{
  "mealId": "meal_123",
  "eatenAt": "2026-10-25T12:30:00Z",
  "reminders": [
    {
      "type": "1h",
      "scheduledAt": "2026-10-25T13:30:00Z"
    },
    {
      "type": "4h",
      "scheduledAt": "2026-10-25T16:30:00Z"
    }
  ]
}
```

---

## 5. Vorschlagsliste

### `GET /api/food-suggestions`

Gibt die letzten Essensnamen zurück, sortiert nach Häufigkeit.

Response:

```json
[
  { "name": "Obst", "usageCount": 7, "lastUsedAt": "2026-10-25T08:00:00Z" },
  { "name": "Brot", "usageCount": 4, "lastUsedAt": "2026-10-25T12:00:00Z" }
]
```

### `POST /api/food-suggestions`

Optional, falls die Vorschlagsliste serverseitig verwaltet werden soll.

---

## 6. Synchronisation

### Client-Verhalten

Beim Start oder nach jeder Nutzereingabe:

1. `GET /api/meals`
2. `GET /api/symptoms`
3. `GET /api/wellbeing`
4. lokale Änderungen an den Server senden

### Server-Verhalten

- prüft gültige Daten
- speichert Einträge
- liefert aktuelle Versionen zurück

### Empfohlene Strategie

- einfache Polling-Synchronisierung reicht
- keine WebSockets erforderlich für den MVP

---

## 7. Beispiel-Flow

### Mahlzeit speichern

Request:

```http
POST /api/meals
```

Body:

```json
{
  "name": "Apfel",
  "eatenAt": "2026-10-25T12:15:00Z"
}
```

Server antwortet:

```json
{
  "id": "meal_456",
  "name": "Apfel",
  "eatenAt": "2026-10-25T12:15:00Z",
  "createdAt": "2026-10-25T12:16:00Z",
  "updatedAt": "2026-10-25T12:16:00Z",
  "reminderState": "pending"
}
```

Daraufhin erzeugt der Server automatisch:

```json
[
  {
    "mealId": "meal_456",
    "reminderType": "1h",
    "scheduledAt": "2026-10-25T13:15:00Z"
  },
  {
    "mealId": "meal_456",
    "reminderType": "4h",
    "scheduledAt": "2026-10-25T16:15:00Z"
  }
]
```

---

## 8. offene Designentscheidungen

### 8.1 Authentifizierung

Für den MVP reicht eine einfache lokale Authentifizierung:

- Token im Browser
- oder shared secret im lokalem Netzwerk

### 8.2 Browser-Notifications

Die Client-App kann Notification API nutzen, sofern der Browser dies erlaubt. Auf dem iPhone ist das für PWA grundsätzlich begrenzt; für echte Push-Notifications muss später eine native App folgen.

---

## 9. Zusammenfassung

Diese API ist bewusst klein und konzeptionell einfach gehalten. Sie deckt die fachlichen Anforderungen ab, ohne unnötige Komplexität einzuführen. Der Fokus liegt auf:

- einfacher Datenhaltung
- lokaler Synchronisierung
- robusten Reminder-Zeitpunkten
- geringer technischen Komplexität für den MVP
