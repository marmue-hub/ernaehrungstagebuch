import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || (
  window.location.hostname === 'localhost' && window.location.port === '5173'
    ? 'http://localhost:8000'
    : ''
);

const SYNC_QUEUE_KEY = 'ernaehrungstagebuch-sync-queue';

const readSyncQueue = () => {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const writeSyncQueue = (queue) => {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
};

const queuePendingEntry = (kind, payload) => {
  const queue = readSyncQueue();
  queue.push({ kind, payload, created_at: new Date().toISOString() });
  writeSyncQueue(queue);
  return queue.length;
};

const formatBerlinDateTimeForInput = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};


const getBerlinOffsetMs = (date) => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  const berlinUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second || 0),
  );

  return berlinUtcMs - date.getTime();
};

const toBerlinIsoString = (value) => {
  if (!value) return new Date().toISOString();

  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);

  const localUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMs = getBerlinOffsetMs(new Date(localUtcMs));

  return new Date(localUtcMs - offsetMs).toISOString();
};

const initialState = {
  username: '',
  mealName: '',
  eatenAt: formatBerlinDateTimeForInput(),
  symptomType: 'bauchweh',
  symptomValue: 3,
  symptomAt: formatBerlinDateTimeForInput(),
  wellbeingValue: 2,
  wellbeingAt: formatBerlinDateTimeForInput(),
};

const symptomLabels = {
  1: 'keine Beschwerden',
  2: 'wenig',
  3: 'ein bisschen',
  4: 'stark',
  5: 'sehr stark',
};

const symptomTypeMeta = {
  bauchweh: { label: 'Bauchweh', emoji: '🤕' },
  uebelkeit: { label: 'Übelkeit', emoji: '🤢' },
  kopfschmerzen: { label: 'Kopfschmerzen', emoji: '😵' },
  stress: { label: 'Stress', emoji: '😵‍💫' },
};

const wellbeingEmojis = {
  1: '😄',
  2: '🙂',
  3: '😕',
};

const wellbeingLabels = {
  1: 'mir geht es super!',
  2: 'mir geht es gut',
  3: 'mir geht es richtig schlecht',
};

const formatDateTimeBerlin = (value) => {
  if (!value) return '';

  const date = new Date(value);
  const formatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = part.value;
    }
  }

  return `${values.day}.${values.month}.${values.year} ${values.hour}:${values.minute}`;
};

const getBerlinTimeZoneLabel = (date = new Date()) => {
  const formatter = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    timeZoneName: 'short',
  });

  const timeZoneName = formatter.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value;
  return timeZoneName || 'MEZ';
};

function TimeStampRow({ label, value, onChange }) {
  return (
    <div className="time-field">
      <label>{label}</label>
      <div className="datetime-row">
        <input
          type="datetime-local"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          style={{ flex: 1 }}
        />
        <span className="timezone-badge" aria-label="Zeitzone in Berlin">
          {getBerlinTimeZoneLabel()}
        </span>
      </div>
    </div>
  );
}

function App() {
  const [users, setUsers] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState(() => {
    const saved = localStorage.getItem('ernaehrungstagebuch-selected-user');
    return saved ? Number(saved) : null;
  });
  const [user, setUser] = useState(initialState.username);
  const [status, setStatus] = useState('');
  const [meals, setMeals] = useState([]);
  const [symptoms, setSymptoms] = useState([]);
  const [wellbeing, setWellbeing] = useState([]);
  const [form, setForm] = useState(initialState);
  const [activeTab, setActiveTab] = useState('start');
  const [syncInfo, setSyncInfo] = useState({
    lastSyncAt: null,
    pendingChanges: 0,
    isOffline: false,
  });

  const activeUserName = selectedUserId
    ? users.find((item) => item.id === selectedUserId)?.username || user
    : user;

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_URL}/api/users`);
      if (!response.ok) throw new Error('Benutzer konnten nicht geladen werden');
      const nextUsers = await response.json();
      setUsers(nextUsers);

      if (!nextUsers.length) {
        setSelectedUserId(null);
        localStorage.removeItem('ernaehrungstagebuch-selected-user');
        return;
      }

      const currentSelection = nextUsers.some((item) => item.id === selectedUserId)
        ? selectedUserId
        : nextUsers[0].id;
      setSelectedUserId(currentSelection);
      localStorage.setItem('ernaehrungstagebuch-selected-user', String(currentSelection));
      setUser(nextUsers.find((item) => item.id === currentSelection)?.username || '');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const fetchData = async () => {
    if (!selectedUserId) {
      setMeals([]);
      setSymptoms([]);
      setWellbeing([]);
      return;
    }

    try {
      const [mealRes, symptomRes, wellbeingRes] = await Promise.all([
        fetch(`${API_URL}/api/meals?user_id=${selectedUserId}`),
        fetch(`${API_URL}/api/symptoms?user_id=${selectedUserId}`),
        fetch(`${API_URL}/api/wellbeing?user_id=${selectedUserId}`),
      ]);

      const mealsData = mealRes.ok ? await mealRes.json() : [];
      const symptomsData = symptomRes.ok ? await symptomRes.json() : [];
      const wellbeingData = wellbeingRes.ok ? await wellbeingRes.json() : [];

      setMeals(mealsData);
      setSymptoms(symptomsData);
      setWellbeing(wellbeingData);
      localStorage.setItem('ernaehrungstagebuch-cache', JSON.stringify({
        meals: mealsData,
        symptoms: symptomsData,
        wellbeing: wellbeingData,
      }));
      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: readSyncQueue().length,
        isOffline: false,
      });
    } catch (error) {
      const cached = JSON.parse(localStorage.getItem('ernaehrungstagebuch-cache') || '{"meals":[],"symptoms":[],"wellbeing":[]}');
      setMeals(cached.meals || []);
      setSymptoms(cached.symptoms || []);
      setWellbeing(cached.wellbeing || []);
      setSyncInfo((prev) => ({
        ...prev,
        pendingChanges: readSyncQueue().length,
        isOffline: true,
      }));
      setStatus('Backend nicht erreichbar. Lokale Daten werden angezeigt.');
    }
  };

  const syncQueuedEntries = async () => {
    const queue = readSyncQueue().filter((item) => {
      if (!selectedUserId) return true;
      return item.payload?.user_id === selectedUserId;
    });

    if (!queue.length) {
      setSyncInfo((prev) => ({ ...prev, pendingChanges: 0, isOffline: !navigator.onLine }));
      if (navigator.onLine) {
        setStatus('Keine ausstehenden Synchronisierungen');
      }
      return;
    }

    if (!navigator.onLine) {
      setSyncInfo((prev) => ({ ...prev, pendingChanges: queue.length, isOffline: true }));
      setStatus('Gerät ist offline. Einträge bleiben lokal gespeichert.');
      return;
    }

    const remaining = [];
    for (const item of queue) {
      try {
        const endpoint = item.kind === 'meal'
          ? '/api/meals'
          : item.kind === 'symptom'
            ? '/api/symptoms'
            : '/api/wellbeing';

        const response = await fetch(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
        });

        if (!response.ok) {
          throw new Error('Sync fehlgeschlagen');
        }
      } catch (error) {
        remaining.push(item);
      }
    }

    writeSyncQueue(remaining);
    setSyncInfo({
      lastSyncAt: new Date().toISOString(),
      pendingChanges: remaining.length,
      isOffline: remaining.length > 0 || !navigator.onLine,
    });

    await fetchData();
    if (!remaining.length) {
      setStatus('Synchronisierung erfolgreich');
    } else {
      setStatus('Einige Einträge konnten noch nicht synchronisiert werden');
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUserId === null) return;
    fetchData();
    syncQueuedEntries();
  }, [selectedUserId]);

  useEffect(() => {
    const handleOnline = () => {
      syncQueuedEntries();
    };

    const handleOffline = () => {
      setSyncInfo((prev) => ({ ...prev, isOffline: true }));
      setStatus('Gerät ist offline. Local Storage bleibt aktiv.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [selectedUserId]);

  const handleUserSave = async () => {
    if (!form.username.trim()) {
      setStatus('Bitte Benutzername eingeben');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username }),
      });

      if (!response.ok) {
        throw new Error('Benutzer konnte nicht gespeichert werden');
      }

      const createdUser = await response.json();
      setUser(createdUser.username);
      setForm((prev) => ({ ...prev, username: createdUser.username }));
      setUsers((prev) => [...prev, createdUser]);
      setSelectedUserId(createdUser.id);
      localStorage.setItem('ernaehrungstagebuch-selected-user', String(createdUser.id));
      setStatus(`Benutzer ${createdUser.username} gespeichert`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleMealSubmit = async (event) => {
    event.preventDefault();

    if (!selectedUserId) {
      setStatus('Bitte zuerst einen Benutzer auswählen');
      return;
    }

    const payload = {
      user_id: selectedUserId,
      name: form.mealName,
      eaten_at: toBerlinIsoString(form.eatenAt),
      notes: '',
    };

    try {
      const response = await fetch(`${API_URL}/api/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Mahlzeit konnte nicht gespeichert werden');

      setForm((prev) => ({ ...prev, mealName: '' }));
      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: readSyncQueue().length,
        isOffline: false,
      });
      setStatus('Mahlzeit gespeichert');
      fetchData();
    } catch (error) {
      queuePendingEntry('meal', payload);
      setSyncInfo({
        lastSyncAt: syncInfo.lastSyncAt,
        pendingChanges: readSyncQueue().length,
        isOffline: true,
      });
      setStatus('Mahlzeit lokal gespeichert. Synchronisierung ausstehend.');
    }
  };

  const handleSymptomSubmit = async (event) => {
    event.preventDefault();

    if (!selectedUserId) {
      setStatus('Bitte zuerst einen Benutzer auswählen');
      return;
    }

    const payload = {
      user_id: selectedUserId,
      type: form.symptomType,
      value: Number(form.symptomValue),
      timestamp: toBerlinIsoString(form.symptomAt || formatBerlinDateTimeForInput()),
    };

    try {
      const response = await fetch(`${API_URL}/api/symptoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Symptom konnte nicht gespeichert werden');

      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: readSyncQueue().length,
        isOffline: false,
      });
      setStatus('Symptom gespeichert');
      fetchData();
    } catch (error) {
      queuePendingEntry('symptom', payload);
      setSyncInfo({
        lastSyncAt: syncInfo.lastSyncAt,
        pendingChanges: readSyncQueue().length,
        isOffline: true,
      });
      setStatus('Symptom lokal gespeichert. Synchronisierung ausstehend.');
    }
  };

  const handleWellbeingSubmit = async (event) => {
    event.preventDefault();

    if (!selectedUserId) {
      setStatus('Bitte zuerst einen Benutzer auswählen');
      return;
    }

    const payload = {
      user_id: selectedUserId,
      value: Number(form.wellbeingValue),
      timestamp: toBerlinIsoString(form.wellbeingAt || formatBerlinDateTimeForInput()),
    };

    try {
      const response = await fetch(`${API_URL}/api/wellbeing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Wohlbefinden konnte nicht gespeichert werden');

      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: readSyncQueue().length,
        isOffline: false,
      });
      setStatus('Wohlbefinden gespeichert');
      fetchData();
    } catch (error) {
      queuePendingEntry('wellbeing', payload);
      setSyncInfo({
        lastSyncAt: syncInfo.lastSyncAt,
        pendingChanges: readSyncQueue().length,
        isOffline: true,
      });
      setStatus('Wohlbefinden lokal gespeichert. Synchronisierung ausstehend.');
    }
  };

  const quickActions = [
    {
      id: 'meal',
      icon: '🍽️',
      title: 'Essen erfassen',
      subtitle: 'Was war heute lecker?',
    },
    {
      id: 'mood',
      icon: '💚',
      title: 'Gefühl checken',
      subtitle: 'Wie geht es mir?',
    },
    {
      id: 'history',
      icon: '📘',
      title: 'Verlauf',
      subtitle: 'Meine Tagebücher',
    },
  ];

  const handleExportCsv = async (exportType = 'clinical') => {
    try {
      const baseUrl = selectedUserId
        ? `${API_URL}/api/export/csv?user_id=${selectedUserId}`
        : `${API_URL}/api/export/csv`;
      const exportUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}export_type=${encodeURIComponent(exportType)}`;
      const response = await fetch(exportUrl);
      if (!response.ok) throw new Error('Export fehlgeschlagen');

      const blob = await response.blob();
      const exportBlobUrl = URL.createObjectURL(blob);
      const fileName = exportType === 'clinical'
        ? 'ernaehrungstagebuch-arzt-berater-export.csv'
        : 'ernaehrungstagebuch-export.csv';
      const link = document.createElement('a');
      link.href = exportBlobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(exportBlobUrl);
      setStatus(exportType === 'clinical' ? 'Arzt-/Berater-Export erstellt' : 'CSV exportiert');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleImportCsv = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const importUrl = selectedUserId
        ? `${API_URL}/api/import/csv?user_id=${selectedUserId}`
        : `${API_URL}/api/import/csv`;

      const response = await fetch(importUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'CSV Import fehlgeschlagen');
      }

      const payload = await response.json();
      const summary = payload.imported || {};
      setStatus(
        `CSV importiert: ${summary.meals ?? 0} Mahlzeiten, ${summary.symptoms ?? 0} Symptome, ${summary.wellbeing ?? 0} Wohlbefinden.`
      );
      fetchData();
    } catch (error) {
      setStatus(error.message || 'CSV Import fehlgeschlagen');
    } finally {
      event.target.value = '';
    }
  };

  const averageSymptomValue = symptoms.length
    ? (symptoms.reduce((sum, item) => sum + Number(item.value || 0), 0) / symptoms.length).toFixed(1)
    : '0.0';

  const symptomBreakdown = Object.entries(
    symptoms.reduce((accumulator, item) => {
      const key = item.type || 'unbekannt';
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  const mostFrequentSymptom = symptomBreakdown[0]
    ? `${symptomTypeMeta[symptomBreakdown[0][0]]?.label || symptomBreakdown[0][0]} (${symptomBreakdown[0][1]}x)`
    : 'Keine Symptome';

  const latestWellbeing = wellbeing[0];
  const latestMeal = meals[0];
  const recentMealNames = meals.slice(0, 3).map((meal) => meal.name).join(', ') || 'Keine Mahlzeiten';
  const trackingDays = new Set(
    [...meals, ...symptoms, ...wellbeing].map((item) => new Date(item.eaten_at || item.timestamp).toISOString().slice(0, 10))
  ).size;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-row">
          <h1>Ernährungstagebuch</h1>
          {activeUserName && <span className="header-user-pill">{activeUserName}</span>}
        </div>
        <nav className="tab-bar" aria-label="Hauptnavigation">
          {[
            { id: 'start', label: 'Start' },
            { id: 'meal', label: 'Essen' },
            { id: 'mood', label: 'Gefühl' },
            { id: 'history', label: 'Verlauf' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activeTab === tab.id ? 'tab-button active' : 'tab-button'}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {activeTab === 'start' && (
          <>
            <section className="card hero-card">
              <div className="hero-text">
                <span className="hero-emoji">🌞</span>
                <div>
                  <h2>Hallo du!</h2>
                  <p>Wie geht’s heute?</p>
                </div>
              </div>

              <div className="user-picker">
                <div className="user-picker-header">
                  <span className="user-picker-icon">👤</span>
                  <div>
                    <span className="label-pill">Nutzer auswählen</span>
                    <p className="user-picker-title">Wer schreibt gerade ein?</p>
                  </div>
                </div>

                <select
                  value={selectedUserId ?? ''}
                  className="user-select"
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    setSelectedUserId(nextValue);
                    localStorage.setItem('ernaehrungstagebuch-selected-user', String(nextValue));
                    const nextUser = users.find((item) => item.id === nextValue);
                    setUser(nextUser?.username || '');
                  }}
                >
                  <option value="">Bitte wählen</option>
                  {users.map((item) => (
                    <option key={item.id} value={item.id}>{item.username}</option>
                  ))}
                </select>

              </div>

              <div className="row user-creator-row">
                <input
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  placeholder="Neuen Benutzer anlegen"
                />
                <button onClick={handleUserSave}>Speichern</button>
              </div>
            </section>

            <section className="card game-card">
              <h2>Was möchtest du heute tun?</h2>
              <div className="quick-grid">
                {quickActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    className="quick-action"
                    onClick={() => setActiveTab(action.id)}
                  >
                    <span className="quick-action-icon">{action.icon}</span>
                    <span className="quick-action-title">{action.title}</span>
                    <span className="quick-action-subtitle">{action.subtitle}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="card">
              <h2>Heute auf einen Blick</h2>
              <div className="stat-grid">
                <div className="stat-box">
                  <span className="stat-label">Mahlzeiten</span>
                  <strong>{meals.length}</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Symptome</span>
                  <strong>{symptoms.length}</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Stimmung</span>
                  <strong>{wellbeing.length}</strong>
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === 'meal' && (
          <section className="card">
            <h2>Mahlzeit erfassen</h2>
            <form onSubmit={handleMealSubmit} className="stack">
              <input
                value={form.mealName}
                onChange={(event) => setForm({ ...form, mealName: event.target.value })}
                placeholder="Essen"
              />
              <TimeStampRow
                label="Wann war das?"
                value={form.eatenAt}
                onChange={(value) => setForm({ ...form, eatenAt: value })}
              />
              <button type="submit">Speichern</button>
            </form>
          </section>
        )}

        {activeTab === 'mood' && (
          <>
            <section className="card">
              <h2>Symptome & Stress</h2>
              <form onSubmit={handleSymptomSubmit} className="stack">
                <select
                  value={form.symptomType}
                  onChange={(event) => setForm({ ...form, symptomType: event.target.value })}
                >
                  <option value="bauchweh">Bauchweh</option>
                  <option value="uebelkeit">Übelkeit</option>
                  <option value="kopfschmerzen">Kopfschmerzen</option>
                  <option value="stress">Stress</option>
                </select>
                <div className="range-wrap">
                  <span className="emoji-badge">{symptomTypeMeta[form.symptomType]?.emoji ?? '😵'}</span>
                  <input
                    type="range"
                    min="1"
                    max="5"
                    value={form.symptomValue}
                    onChange={(event) => setForm({ ...form, symptomValue: event.target.value })}
                  />
                </div>
                <p className="label-pill">{symptomLabels[form.symptomValue]}</p>
                <TimeStampRow
                  label="Zeitpunkt"
                  value={form.symptomAt}
                  onChange={(value) => setForm({ ...form, symptomAt: value })}
                />
                <button type="submit">Speichern</button>
              </form>
            </section>

            <section className="card">
              <h2>Gesamtwohlbefinden</h2>
              <form onSubmit={handleWellbeingSubmit} className="stack">
                <div className="range-wrap">
                  <span className="emoji-badge">{wellbeingEmojis[form.wellbeingValue]}</span>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    value={form.wellbeingValue}
                    onChange={(event) => setForm({ ...form, wellbeingValue: event.target.value })}
                  />
                </div>
                <p className="label-pill">{wellbeingLabels[form.wellbeingValue]}</p>
                <TimeStampRow
                  label="Zeitpunkt"
                  value={form.wellbeingAt}
                  onChange={(value) => setForm({ ...form, wellbeingAt: value })}
                />
                <button type="submit">Speichern</button>
              </form>
            </section>
          </>
        )}

        {activeTab === 'history' && (
          <>
            <section className="card clinical-card">
              <h2>Arzt-/Berater-Ansicht</h2>
              <div className="clinical-grid">
                <div className="clinical-metric">
                  <span className="clinical-label">Einträge</span>
                  <strong>{meals.length + symptoms.length + wellbeing.length}</strong>
                </div>
                <div className="clinical-metric">
                  <span className="clinical-label">Durchschnittliche Symptomstärke</span>
                  <strong>{averageSymptomValue}</strong>
                </div>
                <div className="clinical-metric">
                  <span className="clinical-label">Häufigstes Symptom</span>
                  <strong>{mostFrequentSymptom}</strong>
                </div>
                <div className="clinical-metric">
                  <span className="clinical-label">Letztes Wohlbefinden</span>
                  <strong>{latestWellbeing ? `${wellbeingLabels[latestWellbeing.value] || latestWellbeing.value}` : 'Keine Daten'}</strong>
                </div>
              </div>

              <div className="clinical-detail-list">
                <div>
                  <span className="clinical-label">Aktuelle Mahlzeiten</span>
                  <p>{recentMealNames}</p>
                </div>
                <div>
                  <span className="clinical-label">Letzte Mahlzeit</span>
                  <p>{latestMeal ? `${latestMeal.name} · ${formatDateTimeBerlin(latestMeal.eaten_at)}` : 'Keine Mahlzeiten'}</p>
                </div>
                <div>
                  <span className="clinical-label">Erfassungs-Tage</span>
                  <p>{trackingDays}</p>
                </div>
              </div>
            </section>

            <section className="card">
              <h2>Verlauf & Export</h2>
              <div className="sync-banner">
                <span className={syncInfo.isOffline ? 'sync-status offline' : 'sync-status online'}>
                  {syncInfo.isOffline
                    ? `${syncInfo.pendingChanges} Änderung(en) warten auf Synchronisierung`
                    : syncInfo.lastSyncAt
                      ? `Letzte Synchronisierung: ${formatDateTimeBerlin(syncInfo.lastSyncAt)}`
                      : 'Noch keine Synchronisierung'}
                </span>
                <button type="button" className="sync-button" onClick={syncQueuedEntries}>
                  Jetzt synchronisieren
                </button>
              </div>
              <div className="history-actions">
                <button type="button" onClick={() => handleExportCsv('clinical')}>
                  Arzt-/Berater-Export
                </button>
                <button type="button" onClick={() => handleExportCsv('standard')}>
                  Standard-CSV exportieren
                </button>
                <label className="import-button">
                  CSV importieren
                  <input type="file" accept=".csv,text/csv" onChange={handleImportCsv} />
                </label>
              </div>

              <div className="summary-grid">
              <div>
                <h3>Mahlzeiten</h3>
                <ul>
                  {meals.length ? meals.map((meal) => (
                    <li key={meal.id}>
                      {meal.name} · {formatDateTimeBerlin(meal.eaten_at)}
                    </li>
                  )) : <li>Keine Daten</li>}
                </ul>
              </div>
              <div>
                <h3>Symptome</h3>
                <ul>
                  {symptoms.length ? symptoms.map((item) => {
                    const symptomMeta = symptomTypeMeta[item.type] ?? { label: item.type, emoji: '😵' };

                    return (
                      <li key={item.id}>
                        <span className="entry-badge">{symptomMeta.emoji} {symptomMeta.label}</span>
                        <span>{symptomLabels[item.value] ?? item.value}</span>
                        <small>{formatDateTimeBerlin(item.timestamp)}</small>
                      </li>
                    );
                  }) : <li>Keine Daten</li>}
                </ul>
              </div>
              <div>
                <h3>Wohlbefinden</h3>
                <ul>
                  {wellbeing.length ? wellbeing.map((item) => (
                    <li key={item.id}>
                      <span className="entry-badge mood">{wellbeingEmojis[item.value] ?? item.value}</span>
                      <small>{formatDateTimeBerlin(item.timestamp)}</small>
                    </li>
                  )) : <li>Keine Daten</li>}
                </ul>
              </div>
            </div>
          </section>
          </>
        )}

        {status && <p className="status">{status}</p>}
      </main>
    </div>
  );
}

export default App;
