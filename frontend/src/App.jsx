import { useEffect, useRef, useState } from 'react';

const APP_ENV = import.meta.env.VITE_APP_ENV || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'development'
    : 'production'
);

const API_URL = import.meta.env.VITE_API_URL || (
  APP_ENV === 'production'
    ? ''
    : 'http://localhost:8000'
);

// Resolves to a private IP (192.168.111.10), i.e. only reachable from the home network: sync happens exclusively there.
const HOME_CHECK_URL = import.meta.env.VITE_HOME_CHECK_URL ?? (
  APP_ENV === 'production' ? 'https://wiegehts.x73.eu/' : ''
);
const HOME_CHECK_TIMEOUT_MS = 4000;
const HOME_CHECK_CACHE_MS = 30000;
const AUTO_SYNC_INTERVAL_MS = 60000;

const SYNC_QUEUE_KEY = 'ernaehrungstagebuch-sync-queue';
const USERS_CACHE_KEY = 'ernaehrungstagebuch-users';
const DATA_CACHE_KEY_PREFIX = 'ernaehrungstagebuch-cache-';
const SYNC_QUEUE_DB = 'ernaehrungstagebuch-sync-db';
const SYNC_QUEUE_STORE = 'sync-queue';

const AUTH_TOKEN_KEY = 'ernaehrungstagebuch-auth-token';

const isNetworkError = (error) => error instanceof TypeError;

const readAuthToken = () => {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch (error) {
    return '';
  }
};

// Set by App: shows the login screen when the server rejects the token
let handleUnauthorized = () => {};

const apiFetch = async (url, options = {}) => {
  const headers = new Headers(options.headers || {});
  const token = readAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    handleUnauthorized();
  }
  return response;
};
const notInHomeNetworkError = () => new TypeError('Nicht im Heimnetz');

let homeCheckResult = { checkedAt: 0, reachable: false };

const isInHomeNetwork = async () => {
  if (!navigator.onLine) return false;
  if (!HOME_CHECK_URL) return true;
  if (Date.now() - homeCheckResult.checkedAt < HOME_CHECK_CACHE_MS) return homeCheckResult.reachable;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOME_CHECK_TIMEOUT_MS);
  let reachable = false;

  try {
    const url = new URL(HOME_CHECK_URL);
    url.searchParams.set('__home_check', String(Date.now()));
    // no-cors: an opaque response is enough to prove reachability
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    reachable = true;
  } catch (error) {
    reachable = false;
  } finally {
    clearTimeout(timeout);
  }

  homeCheckResult = { checkedAt: Date.now(), reachable };
  return reachable;
};

const readJsonFromStorage = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
};

// Shows queued, not yet synchronised changes on top of the server data.
const applyPendingChanges = (entries, kind, queue, userId) => {
  let result = [...entries];

  for (const item of queue) {
    if (item.kind !== kind) continue;

    if (item.action === 'delete') {
      result = result.filter((entry) => entry.id !== item.payload.id);
    } else if (item.action === 'update') {
      result = result.map((entry) => (
        entry.id === item.payload.id ? { ...entry, ...item.payload, pending: true } : entry
      ));
    } else if (item.payload?.user_id === userId) {
      result.push({ ...item.payload, id: `pending-${item.id}`, pending: true });
    }
  }

  return result;
};

const openSyncQueueDatabase = () => new Promise((resolve, reject) => {
  if (!('indexedDB' in window)) {
    resolve(null);
    return;
  }

  const request = window.indexedDB.open(SYNC_QUEUE_DB, 1);

  request.onupgradeneeded = (event) => {
    const db = event.target.result;
    if (!db.objectStoreNames.contains(SYNC_QUEUE_STORE)) {
      db.createObjectStore(SYNC_QUEUE_STORE, { keyPath: 'id' });
    }
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB konnte nicht geöffnet werden'));
});

const readLegacySyncQueue = () => {
  const parsed = readJsonFromStorage(SYNC_QUEUE_KEY, []);
  return Array.isArray(parsed)
    ? parsed.filter((item) => item && item.kind && item.payload).map((item) => ({ action: 'create', ...item }))
    : [];
};

const withQueueIds = (queue) => queue.map((entry, index) => ({
  ...entry,
  id: entry.id || `${entry.kind}-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
  order: index,
}));

const readQueueFromDatabase = (db) => new Promise((resolve, reject) => {
  const transaction = db.transaction(SYNC_QUEUE_STORE, 'readonly');
  const request = transaction.objectStore(SYNC_QUEUE_STORE).getAll();

  request.onsuccess = () => {
    const result = Array.isArray(request.result) ? request.result : [];
    resolve(result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  };
  request.onerror = () => reject(request.error || new Error('Sync-Queue konnte nicht gelesen werden'));
});

const writeQueueToDatabase = (db, queue) => new Promise((resolve, reject) => {
  const transaction = db.transaction(SYNC_QUEUE_STORE, 'readwrite');
  const store = transaction.objectStore(SYNC_QUEUE_STORE);
  transaction.oncomplete = () => resolve(queue);
  transaction.onerror = () => reject(transaction.error || new Error('Sync-Queue konnte nicht geschrieben werden'));

  store.clear();
  queue.forEach((entry) => store.put(entry));
});

const readSyncQueue = async () => {
  let db = null;
  try {
    db = await openSyncQueueDatabase();
    if (!db) return readLegacySyncQueue();

    const stored = await readQueueFromDatabase(db);

    // Entries queued by the former localStorage-only version
    const legacyEntries = readLegacySyncQueue();
    if (!legacyEntries.length) return stored;

    const merged = await writeQueueToDatabase(db, withQueueIds([...stored, ...legacyEntries]));
    localStorage.removeItem(SYNC_QUEUE_KEY);
    return merged;
  } catch (error) {
    return readLegacySyncQueue();
  } finally {
    db?.close();
  }
};

const writeSyncQueue = async (queue) => {
  const entries = withQueueIds(queue);
  let db = null;
  try {
    db = await openSyncQueueDatabase();
    if (db) return await writeQueueToDatabase(db, entries);
  } catch (error) {
    // fall through to localStorage
  } finally {
    db?.close();
  }

  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(entries));
  return entries;
};

const queuePendingEntry = async (kind, payload, action = 'create', remoteId = null) => {
  const queue = await readSyncQueue();
  const nextEntry = {
    id: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    action,
    remoteId,
    payload,
    created_at: new Date().toISOString(),
  };

  queue.push(nextEntry);
  await writeSyncQueue(queue);
  return queue.length;
};

const toDateTimeLocalValue = (value) => {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
  const [pendingQueue, setPendingQueue] = useState([]);
  const [needsLogin, setNeedsLogin] = useState(() => !readAuthToken());
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const syncInProgress = useRef(false);
  const [form, setForm] = useState(initialState);
  const [lastSavedMeal, setLastSavedMeal] = useState('');
  const [activeTab, setActiveTab] = useState('start');
  const [route, setRoute] = useState(() => (
    window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
      ? 'admin'
      : 'app'
  ));
  const [syncInfo, setSyncInfo] = useState({
    lastSyncAt: null,
    pendingChanges: 0,
    isOffline: false,
  });

  const navigateTo = (nextRoute) => {
    const targetPath = nextRoute === 'admin' ? '/admin' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setRoute(nextRoute);
  };

  useEffect(() => {
    const handleLocationChange = () => {
      const nextRoute = window.location.pathname === '/admin' || window.location.pathname.startsWith('/admin/')
        ? 'admin'
        : 'app';
      setRoute(nextRoute);
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  const activeUserName = selectedUserId
    ? users.find((item) => item.id === selectedUserId)?.username || user
    : user;
  const [adminUserName, setAdminUserName] = useState('');
  const [adminTargetUserId, setAdminTargetUserId] = useState('all');
  const [adminRenameDrafts, setAdminRenameDrafts] = useState({});
  const [adminEntries, setAdminEntries] = useState({ meals: [], symptoms: [], wellbeing: [] });
  const [adminEntryDrafts, setAdminEntryDrafts] = useState({});

  const fetchUsers = async () => {
    try {
      const response = await apiFetch(`${API_URL}/api/users`);
      if (!response.ok) throw new Error('Benutzer konnten nicht geladen werden');
      const nextUsers = await response.json();
      setUsers(nextUsers);
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(nextUsers));

      if (!nextUsers.length) {
        setSelectedUserId(null);
        setAdminTargetUserId('all');
        localStorage.removeItem('ernaehrungstagebuch-selected-user');
        return;
      }

      const currentSelection = nextUsers.some((item) => item.id === selectedUserId)
        ? selectedUserId
        : nextUsers[0].id;
      setSelectedUserId(currentSelection);
      localStorage.setItem('ernaehrungstagebuch-selected-user', String(currentSelection));
      setUser(nextUsers.find((item) => item.id === currentSelection)?.username || '');

      if (route === 'admin' && adminTargetUserId === 'all') {
        setAdminTargetUserId(String(currentSelection));
      }
    } catch (error) {
      const cachedUsers = readJsonFromStorage(USERS_CACHE_KEY, []);
      if (!isNetworkError(error) || !cachedUsers.length) {
        setStatus(error.message);
        return;
      }

      setUsers(cachedUsers);
      const cachedSelection = cachedUsers.find((item) => item.id === selectedUserId);
      if (cachedSelection) {
        setUser(cachedSelection.username);
      }
      setStatus('Offline: gespeicherte Benutzerliste wird verwendet.');
    }
  };

  const refreshPendingQueue = async () => {
    const queue = await readSyncQueue();
    setPendingQueue(queue);
    return queue;
  };

  const fetchAdminEntries = async (targetUserId = adminTargetUserId) => {
    const normalizedUserId = targetUserId === 'all' ? null : Number(targetUserId);

    try {
      const [mealRes, symptomRes, wellbeingRes] = await Promise.all([
        apiFetch(`${API_URL}/api/meals${normalizedUserId ? `?user_id=${normalizedUserId}` : ''}`),
        apiFetch(`${API_URL}/api/symptoms${normalizedUserId ? `?user_id=${normalizedUserId}` : ''}`),
        apiFetch(`${API_URL}/api/wellbeing${normalizedUserId ? `?user_id=${normalizedUserId}` : ''}`),
      ]);

      const mealsData = mealRes.ok ? await mealRes.json() : [];
      const symptomsData = symptomRes.ok ? await symptomRes.json() : [];
      const wellbeingData = wellbeingRes.ok ? await wellbeingRes.json() : [];

      setAdminEntries({
        meals: mealsData,
        symptoms: symptomsData,
        wellbeing: wellbeingData,
      });
    } catch (error) {
      setStatus(error.message || 'Einträge konnten nicht geladen werden');
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
        apiFetch(`${API_URL}/api/meals?user_id=${selectedUserId}`),
        apiFetch(`${API_URL}/api/symptoms?user_id=${selectedUserId}`),
        apiFetch(`${API_URL}/api/wellbeing?user_id=${selectedUserId}`),
      ]);

      if ([mealRes, symptomRes, wellbeingRes].some((response) => response.status === 401)) {
        return;
      }

      const mealsData = mealRes.ok ? await mealRes.json() : [];
      const symptomsData = symptomRes.ok ? await symptomRes.json() : [];
      const wellbeingData = wellbeingRes.ok ? await wellbeingRes.json() : [];

      setMeals(mealsData);
      setSymptoms(symptomsData);
      setWellbeing(wellbeingData);
      localStorage.setItem(`${DATA_CACHE_KEY_PREFIX}${selectedUserId}`, JSON.stringify({
        meals: mealsData,
        symptoms: symptomsData,
        wellbeing: wellbeingData,
      }));
      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: (await refreshPendingQueue()).length,
        isOffline: false,
      });
    } catch (error) {
      const cached = readJsonFromStorage(`${DATA_CACHE_KEY_PREFIX}${selectedUserId}`, {});
      const pendingChanges = (await refreshPendingQueue()).length;
      setMeals(cached.meals || []);
      setSymptoms(cached.symptoms || []);
      setWellbeing(cached.wellbeing || []);
      setSyncInfo((prev) => ({
        ...prev,
        pendingChanges,
        isOffline: true,
      }));
      setStatus('Server nicht erreichbar. Lokale Daten werden angezeigt.');
    }
  };

  const syncQueuedEntries = async ({ silent = false } = {}) => {
    if (syncInProgress.current) return;
    syncInProgress.current = true;

    try {
      await runSync(silent === true);
    } finally {
      syncInProgress.current = false;
    }
  };

  const runSync = async (silent) => {
    const fullQueue = await refreshPendingQueue();
    const belongsToCurrentUser = (item) => {
      if (!selectedUserId) return true;
      if (item.payload?.user_id === undefined) return true;
      return item.payload.user_id === selectedUserId;
    };
    const queue = fullQueue.filter(belongsToCurrentUser);
    const otherEntries = fullQueue.filter((item) => !belongsToCurrentUser(item));

    if (!queue.length) {
      setSyncInfo((prev) => ({ ...prev, pendingChanges: 0 }));
      if (!silent) {
        setStatus('Keine ausstehenden Synchronisierungen');
      }
      return;
    }

    homeCheckResult.checkedAt = 0;
    if (!(await isInHomeNetwork())) {
      setSyncInfo((prev) => ({ ...prev, pendingChanges: queue.length, isOffline: true }));
      if (!silent) {
        setStatus('Nicht im Heimnetz. Einträge bleiben lokal gespeichert und werden zu Hause synchronisiert.');
      }
      return;
    }

    const remaining = [];
    for (const item of queue) {
      try {
        const entityName = item.kind === 'meal'
          ? 'meals'
          : item.kind === 'symptom'
            ? 'symptoms'
            : 'wellbeing';

        const isDelete = item.action === 'delete';
        const isUpdate = item.action === 'update';

        const baseUrl = `${API_URL}/api/${entityName}`;
        let response;

        if (isDelete) {
          response = await apiFetch(`${baseUrl}/${item.payload.id}`, { method: 'DELETE' });
        } else if (isUpdate) {
          response = await apiFetch(`${baseUrl}/${item.payload.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } else {
          response = await apiFetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        }

        // 404 on update/delete: entry no longer exists on the server, nothing left to sync
        if (!response.ok && !((isDelete || isUpdate) && response.status === 404)) {
          throw new Error('Sync fehlgeschlagen');
        }
      } catch (error) {
        remaining.push(item);
      }
    }

    await writeSyncQueue([...otherEntries, ...remaining]);
    setPendingQueue([...otherEntries, ...remaining]);
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
    handleUnauthorized = () => {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setNeedsLogin(true);
    };

    if (readAuthToken()) {
      fetchUsers();
      return;
    }

    // Without APP_PASSWORD (local development) the server accepts requests without token
    apiFetch(`${API_URL}/api/auth/check`)
      .then((response) => {
        if (response.ok) {
          setNeedsLogin(false);
          fetchUsers();
        }
      })
      .catch(() => {});
  }, []);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoginError('');

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Anmeldung fehlgeschlagen');
      }

      const { token } = await response.json();
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      setLoginPassword('');
      setNeedsLogin(false);
      setStatus('');
      await fetchUsers();
      await fetchData();
      syncQueuedEntries({ silent: true });
    } catch (error) {
      setLoginError(isNetworkError(error)
        ? 'Server nicht erreichbar. Die Anmeldung ist nur im Heimnetz möglich.'
        : error.message);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setNeedsLogin(true);
  };

  useEffect(() => {
    if (route !== 'admin') return;

    if (users.length && adminTargetUserId === 'all' && selectedUserId !== null) {
      setAdminTargetUserId(String(selectedUserId));
      return;
    }

    fetchAdminEntries(adminTargetUserId);
  }, [route, adminTargetUserId, users, selectedUserId]);

  useEffect(() => {
    if (selectedUserId === null) return;
    fetchData();
    syncQueuedEntries({ silent: true });
  }, [selectedUserId]);

  useEffect(() => {
    const handleOnline = () => {
      syncQueuedEntries({ silent: true });
    };

    // Switching from mobile data to the home WLAN fires no 'online' event, so check regularly.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncQueuedEntries({ silent: true });
      }
    };

    const interval = setInterval(async () => {
      if ((await readSyncQueue()).length) {
        syncQueuedEntries({ silent: true });
      }
    }, AUTO_SYNC_INTERVAL_MS);

    const handleOffline = () => {
      setSyncInfo((prev) => ({ ...prev, isOffline: true }));
      setStatus('Gerät ist offline. Local Storage bleibt aktiv.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [selectedUserId]);

  const handleUserSave = async () => {
    if (!form.username.trim()) {
      setStatus('Bitte Benutzername eingeben');
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/users`, {
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

  const handleAdminEntryDraftChange = (type, entryId, field, value) => {
    const key = `${type}-${entryId}`;
    setAdminEntryDrafts((previous) => ({
      ...previous,
      [key]: {
        ...(previous[key] || {}),
        [field]: value,
      },
    }));
  };

  const handleAdminEntrySave = async (type, entry) => {
    const key = `${type}-${entry.id}`;
    const draft = adminEntryDrafts[key] || {};
    const payload = {
      user_id: entry.user_id,
    };

    try {

      if (type === 'meal') {
        payload.name = (draft.name ?? entry.name).trim();
        payload.eaten_at = new Date(draft.eaten_at ?? entry.eaten_at).toISOString();
        payload.notes = draft.notes ?? entry.notes ?? '';
      }

      if (type === 'symptom') {
        payload.type = draft.type ?? entry.type;
        payload.value = Number(draft.value ?? entry.value);
        payload.timestamp = new Date(draft.timestamp ?? entry.timestamp).toISOString();
      }

      if (type === 'wellbeing') {
        payload.value = Number(draft.value ?? entry.value);
        payload.timestamp = new Date(draft.timestamp ?? entry.timestamp).toISOString();
      }

      if (!(await isInHomeNetwork())) throw notInHomeNetworkError();

      const response = await apiFetch(`${API_URL}/api/${type === 'meal' ? 'meals' : type === 'symptom' ? 'symptoms' : 'wellbeing'}/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Eintrag konnte nicht gespeichert werden');
      }

      setStatus('Eintrag gespeichert');
      await fetchAdminEntries(adminTargetUserId);
    } catch (error) {
      if (!isNetworkError(error)) {
        setStatus(error.message || 'Eintrag konnte nicht gespeichert werden');
        return;
      }
      await queuePendingEntry(type, { ...payload, id: entry.id }, 'update');
      await refreshPendingQueue();
      setStatus('Eintrag lokal gespeichert und wird synchronisiert, sobald die Verbindung wieder da ist.');
    }
  };

  const handleAdminEntryDelete = async (type, entryId) => {
    try {
      if (!(await isInHomeNetwork())) throw notInHomeNetworkError();

      const response = await apiFetch(`${API_URL}/api/${type === 'meal' ? 'meals' : type === 'symptom' ? 'symptoms' : 'wellbeing'}/${entryId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Eintrag konnte nicht gelöscht werden');
      }

      setStatus('Eintrag gelöscht');
      await fetchAdminEntries(adminTargetUserId);
    } catch (error) {
      if (!isNetworkError(error)) {
        setStatus(error.message || 'Eintrag konnte nicht gelöscht werden');
        return;
      }
      await queuePendingEntry(type, { id: entryId }, 'delete');
      await refreshPendingQueue();
      setStatus('Löschen lokal vermerkt und wird synchronisiert, sobald die Verbindung wieder da ist.');
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
      if (!(await isInHomeNetwork())) throw notInHomeNetworkError();

      const response = await apiFetch(`${API_URL}/api/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Mahlzeit konnte nicht gespeichert werden');

      const savedMealName = payload.name?.trim() || 'Mahlzeit';
      const savedMealTime = formatDateTimeBerlin(payload.eaten_at);
      setForm((prev) => ({ ...prev, mealName: '' }));
      setLastSavedMeal(`${savedMealName} · ${savedMealTime}`);
      const queueCount = (await readSyncQueue()).length;
      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: queueCount,
        isOffline: false,
      });
      setStatus(`Gespeichert: ${savedMealName} · ${savedMealTime}`);
      fetchData();
    } catch (error) {
      await queuePendingEntry('meal', payload, 'create');
      const pendingAfterQueue = await refreshPendingQueue();
      const savedMealName = payload.name?.trim() || 'Mahlzeit';
      const savedMealTime = formatDateTimeBerlin(payload.eaten_at);
      setForm((prev) => ({ ...prev, mealName: '' }));
      setLastSavedMeal(`Lokal gespeichert: ${savedMealName} · ${savedMealTime}`);
      setSyncInfo({
        lastSyncAt: syncInfo.lastSyncAt,
        pendingChanges: pendingAfterQueue.length,
        isOffline: true,
      });
      setStatus('Mahlzeit lokal gespeichert. Wird im Heimnetz synchronisiert.');
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
      if (!(await isInHomeNetwork())) throw notInHomeNetworkError();

      const response = await apiFetch(`${API_URL}/api/symptoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Symptom konnte nicht gespeichert werden');

      const queueCount = (await readSyncQueue()).length;
      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: queueCount,
        isOffline: false,
      });
      setStatus('Symptom gespeichert');
      fetchData();
    } catch (error) {
      await queuePendingEntry('symptom', payload, 'create');
      const pendingAfterQueue = await refreshPendingQueue();
      setSyncInfo({
        lastSyncAt: syncInfo.lastSyncAt,
        pendingChanges: pendingAfterQueue.length,
        isOffline: true,
      });
      setStatus('Symptom lokal gespeichert. Wird im Heimnetz synchronisiert.');
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
      if (!(await isInHomeNetwork())) throw notInHomeNetworkError();

      const response = await apiFetch(`${API_URL}/api/wellbeing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error('Wohlbefinden konnte nicht gespeichert werden');

      const queueCount = (await readSyncQueue()).length;
      setSyncInfo({
        lastSyncAt: new Date().toISOString(),
        pendingChanges: queueCount,
        isOffline: false,
      });
      setStatus('Wohlbefinden gespeichert');
      fetchData();
    } catch (error) {
      await queuePendingEntry('wellbeing', payload, 'create');
      const pendingAfterQueue = await refreshPendingQueue();
      setSyncInfo({
        lastSyncAt: syncInfo.lastSyncAt,
        pendingChanges: pendingAfterQueue.length,
        isOffline: true,
      });
      setStatus('Wohlbefinden lokal gespeichert. Wird im Heimnetz synchronisiert.');
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

  const handleAdminCreateUser = async () => {
    const username = adminUserName.trim();
    if (!username) {
      setStatus('Bitte Administrator-Benutzername eingeben');
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Benutzer konnte nicht angelegt werden');
      }

      setAdminUserName('');
      await fetchUsers();
      setStatus(`Benutzer ${username} angelegt`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleAdminRenameUser = async (userId) => {
    const username = (adminRenameDrafts[userId] || '').trim();
    if (!username) {
      setStatus('Bitte neuen Benutzernamen eingeben');
      return;
    }

    try {
      const response = await apiFetch(`${API_URL}/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Benutzer konnte nicht umbenannt werden');
      }

      await fetchUsers();
      setStatus(`Benutzer umbenannt in ${username}`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleAdminDeleteUser = async (userId) => {
    const userToDelete = users.find((user) => user.id === userId);
    if (!userToDelete) return;

    const confirmed = window.confirm(`Benutzer "${userToDelete.username}" und alle zugehörigen Einträge wirklich löschen?`);
    if (!confirmed) return;

    try {
      const response = await apiFetch(`${API_URL}/api/users/${userId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Benutzer konnte nicht gelöscht werden');
      }

      if (selectedUserId === userId) {
        setSelectedUserId(null);
        localStorage.removeItem('ernaehrungstagebuch-selected-user');
      }

      await fetchUsers();
      setStatus(`Benutzer ${userToDelete.username} gelöscht`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleExportCsv = async (exportType = 'clinical') => {
    try {
      const baseUrl = selectedUserId
        ? `${API_URL}/api/export/csv?user_id=${selectedUserId}`
        : `${API_URL}/api/export/csv`;
      const exportUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}export_type=${encodeURIComponent(exportType)}`;
      const response = await apiFetch(exportUrl);
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

  const handleAdminExportCsv = async (userId = null) => {
    try {
      const exportUrl = userId
        ? `${API_URL}/api/export/csv?user_id=${userId}`
        : `${API_URL}/api/export/csv`;
      const response = await apiFetch(exportUrl);
      if (!response.ok) throw new Error('Admin-Export fehlgeschlagen');

      const blob = await response.blob();
      const fileName = userId
        ? `ernaehrungstagebuch-user-${userId}.csv`
        : 'ernaehrungstagebuch-datenbank.csv';
      const exportBlobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = exportBlobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(exportBlobUrl);
      setStatus(userId ? `CSV für Benutzer ${userId} exportiert` : 'Gesamte Datenbank exportiert');
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleAdminImportCsv = async (event, userId = null) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const importUrl = userId
        ? `${API_URL}/api/import/csv?user_id=${userId}`
        : `${API_URL}/api/import/csv`;

      const response = await apiFetch(importUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Admin-CSV Import fehlgeschlagen');
      }

      const payload = await response.json();
      const summary = payload.imported || {};
      setStatus(
        `CSV importiert: ${summary.meals ?? 0} Mahlzeiten, ${summary.symptoms ?? 0} Symptome, ${summary.wellbeing ?? 0} Wohlbefinden.`
      );
      await fetchUsers();
      if (selectedUserId) {
        await fetchData();
      }
    } catch (error) {
      setStatus(error.message || 'Admin-CSV Import fehlgeschlagen');
    } finally {
      event.target.value = '';
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

      const response = await apiFetch(importUrl, {
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

  const visibleMeals = applyPendingChanges(meals, 'meal', pendingQueue, selectedUserId);
  const visibleSymptoms = applyPendingChanges(symptoms, 'symptom', pendingQueue, selectedUserId);
  const visibleWellbeing = applyPendingChanges(wellbeing, 'wellbeing', pendingQueue, selectedUserId);

  const averageSymptomValue = visibleSymptoms.length
    ? (visibleSymptoms.reduce((sum, item) => sum + Number(item.value || 0), 0) / visibleSymptoms.length).toFixed(1)
    : '0.0';

  const symptomBreakdown = Object.entries(
    visibleSymptoms.reduce((accumulator, item) => {
      const key = item.type || 'unbekannt';
      accumulator[key] = (accumulator[key] || 0) + 1;
      return accumulator;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  const mostFrequentSymptom = symptomBreakdown[0]
    ? `${symptomTypeMeta[symptomBreakdown[0][0]]?.label || symptomBreakdown[0][0]} (${symptomBreakdown[0][1]}x)`
    : 'Keine Symptome';

  const sortedMeals = [...visibleMeals].sort((a, b) => new Date(b.eaten_at || b.timestamp) - new Date(a.eaten_at || a.timestamp));
  const sortedSymptoms = [...visibleSymptoms].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const sortedWellbeing = [...visibleWellbeing].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const latestWellbeing = sortedWellbeing[0];
  const latestMeal = sortedMeals[0];
  const recentMealNames = sortedMeals.slice(0, 3).map((meal) => meal.name).join(', ') || 'Keine Mahlzeiten';
  const trackingDays = new Set(
    [...sortedMeals, ...sortedSymptoms, ...sortedWellbeing].map((item) => new Date(item.eaten_at || item.timestamp).toISOString().slice(0, 10))
  ).size;

  const historyEntries = [
    ...sortedMeals.map((meal) => ({
      id: `meal-${meal.id}`,
      type: 'meal',
      label: 'Mahlzeit',
      icon: '🍽️',
      value: meal.name,
      timestamp: meal.eaten_at,
      pending: meal.pending,
    })),
    ...sortedSymptoms.map((item) => {
      const symptomMeta = symptomTypeMeta[item.type] ?? { label: item.type, emoji: '😵' };
      return {
        id: `symptom-${item.id}`,
        type: 'symptom',
        label: symptomMeta.label,
        icon: symptomMeta.emoji,
        value: symptomLabels[item.value] ?? item.value,
        timestamp: item.timestamp,
        pending: item.pending,
      };
    }),
    ...sortedWellbeing.map((item) => ({
      id: `wellbeing-${item.id}`,
      type: 'wellbeing',
      label: 'Wohlbefinden',
      icon: wellbeingEmojis[item.value] ?? '🙂',
      value: wellbeingLabels[item.value] ?? item.value,
      timestamp: item.timestamp,
      pending: item.pending,
    })),
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const getBerlinDateKey = (dateValue) => {
    const date = new Date(dateValue);
    const formatter = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(date);
  };

  const todayKey = getBerlinDateKey(new Date());
  const yesterdayKey = getBerlinDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const historyGroups = {
    today: historyEntries.filter((entry) => getBerlinDateKey(entry.timestamp) === todayKey),
    yesterday: historyEntries.filter((entry) => getBerlinDateKey(entry.timestamp) === yesterdayKey),
    older: historyEntries.filter((entry) => {
      const key = getBerlinDateKey(entry.timestamp);
      return key !== todayKey && key !== yesterdayKey;
    }),
  };

  if (needsLogin) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <div className="topbar-row">
            <h1>Ernährungstagebuch</h1>
          </div>
        </header>

        <main className="content">
          <section className="card">
            <h2>Anmelden</h2>
            <form onSubmit={handleLogin} className="stack">
              <input
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder="App-Passwort"
                aria-label="App-Passwort"
                autoFocus
              />
              <button type="submit" disabled={!loginPassword}>Anmelden</button>
              {loginError && <p className="status">{loginError}</p>}
            </form>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-row">
          <h1>Ernährungstagebuch</h1>
          {activeUserName && <span className="header-user-pill">{activeUserName}</span>}
          <button type="button" className="logout-button" onClick={handleLogout}>Abmelden</button>
        </div>
        {!window.location.pathname.startsWith('/admin') && (
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
        )}
      </header>

      <main className="content">
        {route === 'admin' && (
          <section className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Admin-Bereich</h2>
              <button type="button" onClick={() => navigateTo('app')}>Zurück zur App</button>
            </div>

            <div className="stack">
              <h3>Neuen Benutzer anlegen</h3>
              <div className="row user-creator-row">
                <input
                  value={adminUserName}
                  onChange={(event) => setAdminUserName(event.target.value)}
                  placeholder="Benutzername"
                />
                <button type="button" onClick={handleAdminCreateUser}>Anlegen</button>
              </div>
            </div>

            <div className="stack" style={{ marginTop: '2rem' }}>
              <h3>Benutzer verwalten</h3>
              {users.length ? users.map((userItem) => (
                <div key={userItem.id} className="row admin-user-row">
                  <span className="label-pill">#{userItem.id}</span>
                  <input
                    value={adminRenameDrafts[userItem.id] ?? userItem.username}
                    onChange={(event) => setAdminRenameDrafts((previous) => ({
                      ...previous,
                      [userItem.id]: event.target.value,
                    }))}
                  />
                  <button type="button" onClick={() => handleAdminRenameUser(userItem.id)}>Umbenennen</button>
                  <button type="button" className="danger-button" onClick={() => handleAdminDeleteUser(userItem.id)}>Löschen</button>
                </div>
              )) : <p>Keine Benutzer vorhanden.</p>}
            </div>

            <div className="stack" style={{ marginTop: '2rem' }}>
              <h3>Einträge verwalten</h3>
              <div className="row user-creator-row">
                <select
                  value={adminTargetUserId}
                  onChange={(event) => setAdminTargetUserId(event.target.value)}
                >
                  <option value="all">Gesamte Datenbank</option>
                  {users.map((userItem) => (
                    <option key={userItem.id} value={String(userItem.id)}>
                      {userItem.username}
                    </option>
                  ))}
                </select>
              </div>

              {['meal', 'symptom', 'wellbeing'].map((type) => {
                const entries = type === 'meal'
                  ? adminEntries.meals
                  : type === 'symptom'
                    ? adminEntries.symptoms
                    : adminEntries.wellbeing;

                const totalEntries = adminEntries.meals.length + adminEntries.symptoms.length + adminEntries.wellbeing.length;
                if (!entries.length && totalEntries > 0) return null;

                return (
                  <div key={type} className="stack" style={{ marginTop: '1rem' }}>
                    <h4 style={{ margin: '0 0 0.5rem' }}>
                      {type === 'meal' ? 'Mahlzeiten' : type === 'symptom' ? 'Symptome' : 'Wohlbefinden'}
                    </h4>
                    {!entries.length && (
                      <p style={{ margin: 0, color: '#5d6b5d' }}>
                        Keine {type === 'meal' ? 'Mahlzeiten' : type === 'symptom' ? 'Symptome' : 'Wohlbefinden'} für diesen Benutzer vorhanden.
                      </p>
                    )}
                    {entries.map((entry) => {
                      const draft = adminEntryDrafts[`${type}-${entry.id}`] || {};

                      return (
                        <div key={entry.id} className="row admin-user-row" style={{ flexWrap: 'wrap' }}>
                          <span className="label-pill">#{entry.id}</span>
                          {type === 'meal' && (
                            <>
                              <input
                                value={draft.name ?? entry.name}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'name', event.target.value)}
                              />
                              <input
                                type="datetime-local"
                                value={toDateTimeLocalValue(draft.eaten_at ?? entry.eaten_at)}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'eaten_at', event.target.value)}
                              />
                              <input
                                value={draft.notes ?? entry.notes ?? ''}
                                placeholder="Notiz"
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'notes', event.target.value)}
                              />
                            </>
                          )}
                          {type === 'symptom' && (
                            <>
                              <select
                                value={draft.type ?? entry.type}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'type', event.target.value)}
                              >
                                <option value="bauchweh">Bauchweh</option>
                                <option value="uebelkeit">Übelkeit</option>
                                <option value="kopfschmerzen">Kopfschmerzen</option>
                                <option value="stress">Stress</option>
                              </select>
                              <select
                                value={draft.value ?? entry.value}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'value', event.target.value)}
                              >
                                {[1,2,3,4,5].map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                              <input
                                type="datetime-local"
                                value={toDateTimeLocalValue(draft.timestamp ?? entry.timestamp)}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'timestamp', event.target.value)}
                              />
                            </>
                          )}
                          {type === 'wellbeing' && (
                            <>
                              <select
                                value={draft.value ?? entry.value}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'value', event.target.value)}
                              >
                                <option value="1">1</option>
                                <option value="2">2</option>
                                <option value="3">3</option>
                              </select>
                              <input
                                type="datetime-local"
                                value={toDateTimeLocalValue(draft.timestamp ?? entry.timestamp)}
                                onChange={(event) => handleAdminEntryDraftChange(type, entry.id, 'timestamp', event.target.value)}
                              />
                            </>
                          )}
                          <button type="button" onClick={() => handleAdminEntrySave(type, entry)}>Speichern</button>
                          <button type="button" className="danger-button" onClick={() => handleAdminEntryDelete(type, entry.id)}>Löschen</button>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div className="stack" style={{ marginTop: '2rem' }}>
              <h3>CSV-Import / Export</h3>
              <div className="row user-creator-row">
                <select
                  value={adminTargetUserId}
                  onChange={(event) => setAdminTargetUserId(event.target.value)}
                >
                  <option value="all">Gesamte Datenbank</option>
                  {users.map((userItem) => (
                    <option key={userItem.id} value={String(userItem.id)}>
                      {userItem.username}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => handleAdminExportCsv(adminTargetUserId === 'all' ? null : Number(adminTargetUserId))}>
                  Export
                </button>
                <label className="import-button">
                  Import
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => handleAdminImportCsv(event, adminTargetUserId === 'all' ? null : Number(adminTargetUserId))}
                  />
                </label>
              </div>
            </div>

            <div className="stack" style={{ marginTop: '2rem' }}>
              <h3>Verlauf & Export</h3>
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
              </div>
            </div>

            <section className="card clinical-card" style={{ marginTop: '2rem' }}>
              <h2>Arzt-/Berater-Ansicht</h2>
              <div className="clinical-grid">
                <div className="clinical-metric">
                  <span className="clinical-label">Einträge</span>
                  <strong>{visibleMeals.length + visibleSymptoms.length + visibleWellbeing.length}</strong>
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
          </section>
        )}

        {route !== 'admin' && activeTab === 'start' && (
          <>
            <section className="card hero-card">
              <div className="hero-text">
                <span className="hero-emoji">🌞</span>
                <div>
                  <h2>{activeUserName || 'Hallo!'}</h2>
                  <p>Dein heutiges Tagebuch</p>
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

            </section>

            <section className="card game-card">
              <h2>Was steckt heute in deinem Tagebuch?</h2>
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
                  <strong>{visibleMeals.length}</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Symptome</span>
                  <strong>{visibleSymptoms.length}</strong>
                </div>
                <div className="stat-box">
                  <span className="stat-label">Stimmung</span>
                  <strong>{visibleWellbeing.length}</strong>
                </div>
              </div>
            </section>
          </>
        )}

        {route !== 'admin' && activeTab === 'meal' && (
          <section className="card">
            <h2>Mahlzeit erfassen</h2>
            <form onSubmit={handleMealSubmit} className="stack">
              <input
                value={form.mealName}
                onChange={(event) => {
                  setLastSavedMeal('');
                  setForm({ ...form, mealName: event.target.value });
                }}
                placeholder="Essen"
              />
              <TimeStampRow
                label="Wann war das?"
                value={form.eatenAt}
                onChange={(value) => {
                  setLastSavedMeal('');
                  setForm({ ...form, eatenAt: value });
                }}
              />
              <button type="submit">Speichern</button>
              {lastSavedMeal && <p className="status">Gespeichert: {lastSavedMeal}</p>}
            </form>
          </section>
        )}

        {route !== 'admin' && activeTab === 'mood' && (
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

        {route !== 'admin' && activeTab === 'history' && (
          <>
            <section className="card clinical-card">
              <h2>Arzt-/Berater-Ansicht</h2>
              <div className="clinical-grid">
                <div className="clinical-metric">
                  <span className="clinical-label">Einträge</span>
                  <strong>{visibleMeals.length + visibleSymptoms.length + visibleWellbeing.length}</strong>
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
              <h2>Verlauf</h2>
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

              <div className="summary-grid">
                {['today', 'yesterday', 'older'].map((groupKey) => {
                  const groupLabel = groupKey === 'today' ? 'Heute' : groupKey === 'yesterday' ? 'Gestern' : 'Älter';
                  const items = historyGroups[groupKey];

                  return (
                    <div key={groupKey}>
                      <h3>{groupLabel}</h3>
                      <ul>
                        {items.length ? items.map((item) => (
                          <li key={item.id}>
                            <span className="entry-badge">{item.icon} {item.label}</span>
                            <span>{item.value}</span>
                            <small>{formatDateTimeBerlin(item.timestamp)}</small>
                            {item.pending && <small className="pending-badge">⏳ wartet auf Sync</small>}
                          </li>
                        )) : <li>Keine Daten</li>}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}

        {status && route !== 'admin' && <p className="status">{status}</p>}
      </main>
    </div>
  );
}

export default App;
