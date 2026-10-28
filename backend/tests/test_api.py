import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

# Tests drop all tables: never run them against the development database (app.db)
os.environ['APP_ENV'] = 'test'
os.environ['APP_PASSWORD'] = 'test-passwort'
os.environ['TEST_DATABASE_URL'] = 'sqlite:///' + os.path.join(tempfile.gettempdir(), 'ernaehrungstagebuch-pytest.db')

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from fastapi.testclient import TestClient

from app import auth
from app.database import Base, engine
from app.main import app


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    auth.reset_failed_logins()


anonymous_client = TestClient(app)
client = TestClient(app)
client.headers['Authorization'] = 'Bearer ' + anonymous_client.post(
    '/api/auth/login', json={'password': 'test-passwort'}
).json()['token']


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


def test_import_csv_does_not_duplicate_existing_records():
    user = client.post('/api/users', json={'username': 'importer_repeat'}).json()

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

    response = client.post(
        f'/api/import/csv?user_id={user["id"]}',
        files={'file': ('export.csv', csv_content, 'text/csv')},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload['imported']['meals'] == 0
    assert payload['imported']['symptoms'] == 0
    assert payload['imported']['wellbeing'] == 0

    assert len(client.get(f'/api/meals?user_id={user["id"]}').json()) == 1
    assert len(client.get(f'/api/symptoms?user_id={user["id"]}').json()) == 1
    assert len(client.get(f'/api/wellbeing?user_id={user["id"]}').json()) == 1


def test_admin_can_rename_and_delete_user():
    user = client.post('/api/users', json={'username': 'old_name'}).json()

    rename_response = client.put(f'/api/users/{user["id"]}', json={'username': 'new_name'})
    assert rename_response.status_code == 200, rename_response.text
    assert rename_response.json()['username'] == 'new_name'

    delete_response = client.delete(f'/api/users/{user["id"]}')
    assert delete_response.status_code == 200, delete_response.text
    assert client.get('/api/users').json() == []


def test_admin_can_update_and_delete_individual_entries():
    user = client.post('/api/users', json={'username': 'entry_admin'}).json()

    meal = client.post('/api/meals', json={
        'user_id': user['id'],
        'name': 'Frühstück',
        'eaten_at': datetime(2026, 10, 25, 8, 0, tzinfo=timezone.utc).isoformat(),
        'notes': 'alt',
    }).json()
    symptom = client.post('/api/symptoms', json={
        'user_id': user['id'],
        'type': 'bauchweh',
        'value': 2,
        'timestamp': datetime(2026, 10, 25, 9, 0, tzinfo=timezone.utc).isoformat(),
    }).json()
    wellbeing = client.post('/api/wellbeing', json={
        'user_id': user['id'],
        'value': 2,
        'timestamp': datetime(2026, 10, 25, 10, 0, tzinfo=timezone.utc).isoformat(),
    }).json()

    updated_meal = client.put(f"/api/meals/{meal['id']}", json={
        'user_id': user['id'],
        'name': 'Gebäck',
        'eaten_at': datetime(2026, 10, 25, 8, 30, tzinfo=timezone.utc).isoformat(),
        'notes': 'neu',
    })
    assert updated_meal.status_code == 200, updated_meal.text
    assert updated_meal.json()['name'] == 'Gebäck'

    updated_symptom = client.put(f"/api/symptoms/{symptom['id']}", json={
        'user_id': user['id'],
        'type': 'stress',
        'value': 4,
        'timestamp': datetime(2026, 10, 25, 9, 30, tzinfo=timezone.utc).isoformat(),
    })
    assert updated_symptom.status_code == 200, updated_symptom.text
    assert updated_symptom.json()['type'] == 'stress'

    updated_wellbeing = client.put(f"/api/wellbeing/{wellbeing['id']}", json={
        'user_id': user['id'],
        'value': 1,
        'timestamp': datetime(2026, 10, 25, 10, 30, tzinfo=timezone.utc).isoformat(),
    })
    assert updated_wellbeing.status_code == 200, updated_wellbeing.text
    assert updated_wellbeing.json()['value'] == 1

    assert client.delete(f"/api/meals/{meal['id']}").status_code == 200
    assert client.delete(f"/api/symptoms/{symptom['id']}").status_code == 200
    assert client.delete(f"/api/wellbeing/{wellbeing['id']}").status_code == 200

    assert client.get(f'/api/meals?user_id={user["id"]}').json() == []
    assert client.get(f'/api/symptoms?user_id={user["id"]}').json() == []
    assert client.get(f'/api/wellbeing?user_id={user["id"]}').json() == []


def create_user(username='tester'):
    response = client.post('/api/users', json={'username': username})
    assert response.status_code == 201, response.text
    return response.json()['id']


def test_tests_do_not_use_development_database():
    assert 'ernaehrungstagebuch-pytest.db' in str(engine.url)


def test_api_responses_have_security_headers():
    response = client.get('/api/users')
    assert response.headers['X-Content-Type-Options'] == 'nosniff'
    assert response.headers['X-Frame-Options'] == 'DENY'
    assert response.headers['Cache-Control'] == 'no-store'


def test_username_is_stripped_and_duplicates_with_whitespace_are_rejected():
    first = client.post('/api/users', json={'username': '  anna  '})
    assert first.status_code == 201, first.text
    assert first.json()['username'] == 'anna'

    duplicate = client.post('/api/users', json={'username': 'anna '})
    assert duplicate.status_code == 400

    blank = client.post('/api/users', json={'username': '    '})
    assert blank.status_code == 422


def test_overlong_input_is_rejected():
    user_id = create_user()
    response = client.post('/api/symptoms', json={
        'user_id': user_id,
        'type': 'x' * 51,
        'value': 3,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    })
    assert response.status_code == 422

    response = client.post('/api/meals', json={
        'user_id': user_id,
        'name': 'Suppe',
        'eaten_at': datetime.now(timezone.utc).isoformat(),
        'notes': 'x' * 2001,
    })
    assert response.status_code == 422


def test_symptom_cannot_reference_meal_of_other_user():
    owner_id = create_user('owner')
    other_id = create_user('other')
    meal = client.post('/api/meals', json={
        'user_id': owner_id,
        'name': 'Suppe',
        'eaten_at': datetime.now(timezone.utc).isoformat(),
    })
    assert meal.status_code == 201, meal.text

    response = client.post('/api/symptoms', json={
        'user_id': other_id,
        'meal_id': meal.json()['id'],
        'type': 'bauchweh',
        'value': 2,
        'timestamp': datetime.now(timezone.utc).isoformat(),
    })
    assert response.status_code == 400


def test_export_neutralises_spreadsheet_formulas_and_import_restores_them():
    user_id = create_user()
    client.post('/api/meals', json={
        'user_id': user_id,
        'name': '=HYPERLINK("http://example.com","klick")',
        'eaten_at': datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).isoformat(),
        'notes': '- wenig Salz',
    })

    export = client.get(f'/api/export/csv?user_id={user_id}')
    assert export.status_code == 200
    assert '\'=HYPERLINK' in export.text
    assert ',=HYPERLINK' not in export.text

    client.delete(f"/api/meals/{client.get(f'/api/meals?user_id={user_id}').json()[0]['id']}")
    imported = client.post(
        f'/api/import/csv?user_id={user_id}',
        files={'file': ('export.csv', export.content, 'text/csv')},
    )
    assert imported.status_code == 200, imported.text
    meals = client.get(f'/api/meals?user_id={user_id}').json()
    assert meals[0]['name'] == '=HYPERLINK("http://example.com","klick")'
    assert meals[0]['notes'] == '- wenig Salz'


def import_rows(user_id, rows):
    header = 'entry_type,timestamp_utc,sub_category,name,value,notes\n'
    content = header + '\n'.join(rows) + '\n'
    return client.post(
        f'/api/import/csv?user_id={user_id}',
        files={'file': ('import.csv', content.encode('utf-8'), 'text/csv')},
    )


def test_import_rejects_invalid_rows_without_partial_import():
    user_id = create_user()
    response = import_rows(user_id, [
        'meal,2026-10-25T12:00:00+00:00,meal,Suppe,,',
        'symptom,2026-10-25T13:00:00+00:00,bauchweh,bauchweh,99,',
    ])
    assert response.status_code == 400
    assert 'Zeile 3' in response.json()['detail']
    assert client.get(f'/api/meals?user_id={user_id}').json() == []

    response = import_rows(user_id, ['wellbeing,kein-datum,overall,overall_wellbeing,2,'])
    assert response.status_code == 400


def test_import_rejects_unknown_user_and_oversized_file():
    response = client.post(
        '/api/import/csv?user_id=999',
        files={'file': ('import.csv', b'entry_type\n', 'text/csv')},
    )
    assert response.status_code == 404

    user_id = create_user()
    response = client.post(
        f'/api/import/csv?user_id={user_id}',
        files={'file': ('import.csv', b'x' * (5 * 1024 * 1024 + 1), 'text/csv')},
    )
    assert response.status_code == 413


def test_api_requires_login():
    for method, path in [
        ('get', '/api/users'),
        ('get', '/api/meals'),
        ('get', '/api/export/csv'),
        ('delete', '/api/users/1'),
        ('post', '/api/meals'),
    ]:
        response = getattr(anonymous_client, method)(path)
        assert response.status_code == 401, (method, path)

    assert anonymous_client.get('/health').status_code == 200


def test_login_with_wrong_password_and_forged_tokens_fail():
    assert anonymous_client.post('/api/auth/login', json={'password': 'falsch'}).status_code == 401

    for token in ['', '9999999999', '9999999999.abc', 'abc.def', auth.create_token(now=0)]:
        response = anonymous_client.get('/api/users', headers={'Authorization': f'Bearer {token}'})
        assert response.status_code == 401, token


def test_login_is_blocked_after_too_many_failures():
    for _ in range(auth.MAX_FAILED_LOGINS):
        assert anonymous_client.post('/api/auth/login', json={'password': 'falsch'}).status_code == 401

    blocked = anonymous_client.post('/api/auth/login', json={'password': 'test-passwort'})
    assert blocked.status_code == 429


def test_valid_login_grants_access():
    token = anonymous_client.post('/api/auth/login', json={'password': 'test-passwort'}).json()['token']
    response = anonymous_client.get('/api/auth/check', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 200
