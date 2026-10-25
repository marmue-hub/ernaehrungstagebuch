import { useEffect, useState } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const initialState = {
  username: '',
  mealName: '',
  eatenAt: new Date().toISOString().slice(0, 16),
  symptomType: 'bauchweh',
  symptomValue: 3,
  wellbeingValue: 2,
};

function App() {
  const [user, setUser] = useState(initialState.username);
  const [status, setStatus] = useState('');
  const [meals, setMeals] = useState([]);
  const [symptoms, setSymptoms] = useState([]);
  const [wellbeing, setWellbeing] = useState([]);
  const [form, setForm] = useState(initialState);

  const fetchData = async () => {
    try {
      const [mealRes, symptomRes, wellbeingRes] = await Promise.all([
        fetch(`${API_URL}/api/meals`),
        fetch(`${API_URL}/api/symptoms`),
        fetch(`${API_URL}/api/wellbeing`),
      ]);

      const mealsData = mealRes.ok ? await mealRes.json() : [];
      const symptomsData = symptomRes.ok ? await symptomRes.json() : [];
      const wellbeingData = wellbeingRes.ok ? await wellbeingRes.json() : [];

      setMeals(mealsData);
      setSymptoms(symptomsData);
      setWellbeing(wellbeingData);
    } catch (error) {
      setStatus('Backend nicht erreichbar');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

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

      setUser(form.username);
      setStatus(`Benutzer ${form.username} gespeichert`);
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleMealSubmit = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${API_URL}/api/meals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.mealName,
          eaten_at: new Date(form.eatenAt).toISOString(),
          notes: '',
        }),
      });

      if (!response.ok) throw new Error('Mahlzeit konnte nicht gespeichert werden');

      setForm((prev) => ({ ...prev, mealName: '' }));
      setStatus('Mahlzeit gespeichert');
      fetchData();
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleSymptomSubmit = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${API_URL}/api/symptoms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.symptomType,
          value: Number(form.symptomValue),
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error('Symptom konnte nicht gespeichert werden');

      setStatus('Symptom gespeichert');
      fetchData();
    } catch (error) {
      setStatus(error.message);
    }
  };

  const handleWellbeingSubmit = async (event) => {
    event.preventDefault();

    try {
      const response = await fetch(`${API_URL}/api/wellbeing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: Number(form.wellbeingValue),
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) throw new Error('Wohlbefinden konnte nicht gespeichert werden');

      setStatus('Wohlbefinden gespeichert');
      fetchData();
    } catch (error) {
      setStatus(error.message);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Ernährungstagebuch</h1>
      </header>

      <main className="content">
        <section className="card">
          <h2>Benutzer</h2>
          <div className="row">
            <input
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              placeholder="Benutzername"
            />
            <button onClick={handleUserSave}>Speichern</button>
          </div>
          {user && <p>Aktiver Benutzer: {user}</p>}
        </section>

        <section className="card">
          <h2>Mahlzeit erfassen</h2>
          <form onSubmit={handleMealSubmit} className="stack">
            <input
              value={form.mealName}
              onChange={(event) => setForm({ ...form, mealName: event.target.value })}
              placeholder="Essen"
            />
            <input
              type="datetime-local"
              value={form.eatenAt}
              onChange={(event) => setForm({ ...form, eatenAt: event.target.value })}
            />
            <button type="submit">Speichern</button>
          </form>
        </section>

        <section className="card">
          <h2>Symptome</h2>
          <form onSubmit={handleSymptomSubmit} className="stack">
            <select
              value={form.symptomType}
              onChange={(event) => setForm({ ...form, symptomType: event.target.value })}
            >
              <option value="bauchweh">Bauchweh</option>
              <option value="uebelkeit">Übelkeit</option>
              <option value="kopfschmerzen">Kopfschmerzen</option>
            </select>
            <input
              type="range"
              min="1"
              max="5"
              value={form.symptomValue}
              onChange={(event) => setForm({ ...form, symptomValue: event.target.value })}
            />
            <p>Wert: {form.symptomValue}</p>
            <button type="submit">Speichern</button>
          </form>
        </section>

        <section className="card">
          <h2>Gesamtwohlbefinden</h2>
          <form onSubmit={handleWellbeingSubmit} className="stack">
            <input
              type="range"
              min="1"
              max="3"
              value={form.wellbeingValue}
              onChange={(event) => setForm({ ...form, wellbeingValue: event.target.value })}
            />
            <p>Wert: {form.wellbeingValue}</p>
            <button type="submit">Speichern</button>
          </form>
        </section>

        <section className="card">
          <h2>Einträge</h2>
          <div className="summary-grid">
            <div>
              <h3>Mahlzeiten</h3>
              <ul>
                {meals.length ? meals.map((meal) => <li key={meal.id}>{meal.name}</li>) : <li>Keine Daten</li>}
              </ul>
            </div>
            <div>
              <h3>Symptome</h3>
              <ul>
                {symptoms.length ? symptoms.map((item) => <li key={item.id}>{item.type}: {item.value}</li>) : <li>Keine Daten</li>}
              </ul>
            </div>
            <div>
              <h3>Wohlbefinden</h3>
              <ul>
                {wellbeing.length ? wellbeing.map((item) => <li key={item.id}>Wert: {item.value}</li>) : <li>Keine Daten</li>}
              </ul>
            </div>
          </div>
        </section>

        {status && <p className="status">{status}</p>}
      </main>
    </div>
  );
}

export default App;
