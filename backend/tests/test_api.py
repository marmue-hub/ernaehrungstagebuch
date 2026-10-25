import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


client = TestClient(app)


def test_meal_creation_creates_reminders():
    user_response = client.post('/api/users', json={'username': 'tester'})
    assert user_response.status_code == 201, user_response.text

    meal_time = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc)
    meal_response = client.post('/api/meals', json={
        'name': 'Mittagessen',
        'eaten_at': meal_time.isoformat(),
        'notes': 'Test',
    })
    assert meal_response.status_code == 201, meal_response.text

    reminders_response = client.get('/api/reminders')
    assert reminders_response.status_code == 200, reminders_response.text
    reminders = reminders_response.json()
    assert len(reminders) == 2
    assert [item['reminder_type'] for item in reminders] == ['1h', '4h']


def test_export_csv_returns_data():
    client.post('/api/users', json={'username': 'tester'})
    client.post('/api/meals', json={
        'name': 'Abendessen',
        'eaten_at': datetime(2026, 10, 25, 18, 30, tzinfo=timezone.utc).isoformat(),
        'notes': 'Test',
    })

    response = client.get('/api/export/csv')
    assert response.status_code == 200, response.text
    assert 'text/csv' in response.headers.get('content-type', '')
    assert 'name' in response.text
