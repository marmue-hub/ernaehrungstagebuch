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
    user = client.post('/api/users', json={'username': 'tester'}).json()
    client.post('/api/meals', json={
        'user_id': user['id'],
        'name': 'Abendessen',
        'eaten_at': datetime(2026, 10, 25, 18, 30, tzinfo=timezone.utc).isoformat(),
        'notes': 'Test',
    })
    client.post('/api/symptoms', json={
        'user_id': user['id'],
        'type': 'bauchweh',
        'value': 3,
        'timestamp': datetime(2026, 10, 25, 19, 0, tzinfo=timezone.utc).isoformat(),
    })
    client.post('/api/wellbeing', json={
        'user_id': user['id'],
        'value': 2,
        'timestamp': datetime(2026, 10, 25, 20, 0, tzinfo=timezone.utc).isoformat(),
    })

    response = client.get('/api/export/csv?export_type=clinical')
    assert response.status_code == 200, response.text
    assert 'text/csv' in response.headers.get('content-type', '')
    assert 'entry_type' in response.text
    assert 'timestamp_local' in response.text
    assert 'category' in response.text
    assert 'wellbeing' in response.text
    assert 'export_context' in response.text
    assert 'arzt_ernaehrungsberater' in response.text
    assert 'ernaehrungstagebuch-arzt-berater-export.csv' in response.headers.get('content-disposition', '')


def test_user_specific_data_is_filtered():
    user_one = client.post('/api/users', json={'username': 'anna'}).json()
    user_two = client.post('/api/users', json={'username': 'ben'}).json()

    client.post('/api/meals', json={
        'user_id': user_one['id'],
        'name': 'Frühstück Anna',
        'eaten_at': datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc).isoformat(),
        'notes': 'Anna',
    })
    client.post('/api/meals', json={
        'user_id': user_two['id'],
        'name': 'Frühstück Ben',
        'eaten_at': datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc).isoformat(),
        'notes': 'Ben',
    })

    anna_meals = client.get(f'/api/meals?user_id={user_one["id"]}')
    assert anna_meals.status_code == 200, anna_meals.text
    assert [meal['name'] for meal in anna_meals.json()] == ['Frühstück Anna']

    ben_meals = client.get(f'/api/meals?user_id={user_two["id"]}')
    assert ben_meals.status_code == 200, ben_meals.text
    assert [meal['name'] for meal in ben_meals.json()] == ['Frühstück Ben']


def test_import_csv_imports_exported_records():
    user = client.post('/api/users', json={'username': 'importer'}).json()

    client.post('/api/meals', json={
        'user_id': user['id'],
        'name': 'Frühstück',
        'eaten_at': datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc).isoformat(),
        'notes': 'Frisch',
    })
    client.post('/api/symptoms', json={
        'user_id': user['id'],
        'type': 'bauchweh',
        'value': 3,
        'timestamp': datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc).isoformat(),
    })
    client.post('/api/wellbeing', json={
        'user_id': user['id'],
        'value': 2,
        'timestamp': datetime(2026, 10, 25, 10, 0, tzinfo=timezone.utc).isoformat(),
    })

    export_response = client.get(f'/api/export/csv?user_id={user["id"]}')
    assert export_response.status_code == 200, export_response.text
    csv_content = export_response.text

    recipient = client.post('/api/users', json={'username': 'import_target'}).json()
    response = client.post(
        f'/api/import/csv?user_id={recipient["id"]}',
        files={'file': ('export.csv', csv_content, 'text/csv')},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['imported']['meals'] == 1
    assert payload['imported']['symptoms'] == 1
    assert payload['imported']['wellbeing'] == 1

    meals = client.get(f'/api/meals?user_id={recipient["id"]}')
    assert [meal['name'] for meal in meals.json()] == ['Frühstück']

    symptoms = client.get(f'/api/symptoms?user_id={recipient["id"]}')
    assert symptoms.json()[0]['type'] == 'bauchweh'
    assert symptoms.json()[0]['value'] == 3

    wellbeing = client.get(f'/api/wellbeing?user_id={recipient["id"]}')
    assert wellbeing.json()[0]['value'] == 2
