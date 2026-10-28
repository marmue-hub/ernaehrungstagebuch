import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Query, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.config import DEFAULT_APP_PASSWORD, settings
from app.database import SessionLocal, engine
from app import auth, models, schemas
from app.database import Base

Base.metadata.create_all(bind=engine)

MAX_IMPORT_BYTES = 5 * 1024 * 1024
SYMPTOM_VALUE_RANGE = range(1, 6)
WELLBEING_VALUE_RANGE = range(1, 4)
CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")

is_production = settings.app_env.lower() == "production"

if is_production and not auth.auth_enabled():
    raise RuntimeError("APP_PASSWORD darf in Produktion nicht leer sein")

if settings.app_password == DEFAULT_APP_PASSWORD:
    logging.getLogger("uvicorn.error").warning(
        "Standard-App-Passwort aktiv. Für mehr Sicherheit APP_PASSWORD in .env setzen."
    )

# No interactive API docs in production
app = FastAPI(
    title=settings.app_name,
    docs_url=None if is_production else "/docs",
    redoc_url=None if is_production else "/redoc",
    openapi_url=None if is_production else "/openapi.json",
)

origins = [
    origin.strip()
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    if request.url.path.startswith("/api/"):
        # Health data must not end up in browser or proxy caches
        response.headers["Cache-Control"] = "no-store"
    return response


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Every /api route except the login requires the shared app password
api = APIRouter(dependencies=[Depends(auth.require_auth)])


@app.get("/health")
def health_check():
    return {"status": "ok", "app": settings.app_name}


@app.post("/api/auth/login", response_model=schemas.LoginOut)
def login(payload: schemas.LoginIn):
    if not auth.auth_enabled():
        return {"token": ""}
    if not auth.check_password(payload.password):
        raise HTTPException(status_code=401, detail="Falsches Passwort")
    return {"token": auth.create_token()}


@api.get("/api/auth/check")
def check_auth():
    return {"authenticated": True}


@api.get("/api/users", response_model=List[schemas.UserOut])
def get_users(db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    return users


@api.put("/api/users/{user_id}", response_model=schemas.UserOut)
def update_user(user_id: int, payload: schemas.UserUpdate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")

    normalized_name = payload.username.strip()
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Benutzername darf nicht leer sein")

    duplicate = db.query(models.User).filter(models.User.username == normalized_name, models.User.id != user_id).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Benutzername bereits vorhanden")

    user.username = normalized_name
    user.display_name = payload.display_name.strip() if payload.display_name else normalized_name
    db.commit()
    db.refresh(user)
    return user


@api.delete("/api/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")

    db.query(models.Meal).filter(models.Meal.user_id == user_id).delete()
    db.query(models.Symptom).filter(models.Symptom.user_id == user_id).delete()
    db.query(models.WellbeingEntry).filter(models.WellbeingEntry.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return {"deleted": True, "user_id": user_id}


@api.post("/api/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    normalized_name = payload.username.strip()
    existing = db.query(models.User).filter(models.User.username == normalized_name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Benutzername bereits vorhanden")

    user = models.User(
        username=normalized_name,
        display_name=normalized_name,
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def resolve_user_id(db: Session, user_id: int | None = None) -> int:
    if user_id is not None:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if user is None:
            raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
        return user.id

    user = db.query(models.User).order_by(models.User.id.asc()).first()
    if user is None:
        raise HTTPException(status_code=400, detail="Kein Benutzer vorhanden")
    return user.id


def resolve_meal_id(db: Session, meal_id: int | None, user_id: int) -> int | None:
    if meal_id is None:
        return None
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id, models.Meal.user_id == user_id).first()
    if meal is None:
        raise HTTPException(status_code=400, detail="Mahlzeit gehört nicht zu diesem Benutzer")
    return meal.id


@api.get("/api/meals", response_model=List[schemas.MealOut])
def get_meals(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Meal)
    if user_id is not None:
        query = query.filter(models.Meal.user_id == user_id)
    return query.order_by(models.Meal.eaten_at.desc()).all()


@api.post("/api/meals", response_model=schemas.MealOut, status_code=status.HTTP_201_CREATED)
def create_meal(payload: schemas.MealCreate, db: Session = Depends(get_db)):
    user_id = resolve_user_id(db, payload.user_id)
    now = datetime.utcnow()
    meal = models.Meal(
        user_id=user_id,
        name=payload.name,
        eaten_at=payload.eaten_at,
        notes=payload.notes,
        created_at=now,
        updated_at=now,
    )
    db.add(meal)
    db.commit()
    db.refresh(meal)
    return meal


@api.put("/api/meals/{meal_id}", response_model=schemas.MealOut)
def update_meal(meal_id: int, payload: schemas.MealUpdate, db: Session = Depends(get_db)):
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()
    if meal is None:
        raise HTTPException(status_code=404, detail="Mahlzeit nicht gefunden")

    target_user_id = resolve_user_id(db, payload.user_id if payload.user_id is not None else meal.user_id)
    meal.user_id = target_user_id
    meal.name = payload.name.strip()
    if not meal.name:
        raise HTTPException(status_code=400, detail="Name darf nicht leer sein")
    meal.eaten_at = payload.eaten_at
    meal.notes = payload.notes
    meal.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(meal)
    return meal


@api.delete("/api/meals/{meal_id}")
def delete_meal(meal_id: int, db: Session = Depends(get_db)):
    meal = db.query(models.Meal).filter(models.Meal.id == meal_id).first()
    if meal is None:
        raise HTTPException(status_code=404, detail="Mahlzeit nicht gefunden")
    db.delete(meal)
    db.commit()
    return {"deleted": True, "meal_id": meal_id}


@api.get("/api/symptoms", response_model=List[schemas.SymptomOut])
def get_symptoms(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Symptom)
    if user_id is not None:
        query = query.filter(models.Symptom.user_id == user_id)
    return query.order_by(models.Symptom.timestamp.desc()).all()


@api.post("/api/symptoms", response_model=schemas.SymptomOut, status_code=status.HTTP_201_CREATED)
def create_symptom(payload: schemas.SymptomCreate, db: Session = Depends(get_db)):
    user_id = resolve_user_id(db, payload.user_id)
    now = datetime.utcnow()
    symptom = models.Symptom(
        user_id=user_id,
        meal_id=resolve_meal_id(db, payload.meal_id, user_id),
        type=payload.type,
        value=payload.value,
        timestamp=payload.timestamp,
        created_at=now,
        updated_at=now,
    )
    db.add(symptom)
    db.commit()
    db.refresh(symptom)
    return symptom


@api.put("/api/symptoms/{symptom_id}", response_model=schemas.SymptomOut)
def update_symptom(symptom_id: int, payload: schemas.SymptomUpdate, db: Session = Depends(get_db)):
    symptom = db.query(models.Symptom).filter(models.Symptom.id == symptom_id).first()
    if symptom is None:
        raise HTTPException(status_code=404, detail="Symptom nicht gefunden")

    target_user_id = resolve_user_id(db, payload.user_id if payload.user_id is not None else symptom.user_id)
    symptom.user_id = target_user_id
    symptom.meal_id = resolve_meal_id(db, payload.meal_id, target_user_id)
    symptom.type = payload.type
    symptom.value = payload.value
    symptom.timestamp = payload.timestamp
    symptom.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(symptom)
    return symptom


@api.delete("/api/symptoms/{symptom_id}")
def delete_symptom(symptom_id: int, db: Session = Depends(get_db)):
    symptom = db.query(models.Symptom).filter(models.Symptom.id == symptom_id).first()
    if symptom is None:
        raise HTTPException(status_code=404, detail="Symptom nicht gefunden")
    db.delete(symptom)
    db.commit()
    return {"deleted": True, "symptom_id": symptom_id}


@api.get("/api/wellbeing", response_model=List[schemas.WellbeingOut])
def get_wellbeing(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.WellbeingEntry)
    if user_id is not None:
        query = query.filter(models.WellbeingEntry.user_id == user_id)
    return query.order_by(models.WellbeingEntry.timestamp.desc()).all()


@api.post("/api/wellbeing", response_model=schemas.WellbeingOut, status_code=status.HTTP_201_CREATED)
def create_wellbeing(payload: schemas.WellbeingCreate, db: Session = Depends(get_db)):
    user_id = resolve_user_id(db, payload.user_id)
    now = datetime.utcnow()
    entry = models.WellbeingEntry(
        user_id=user_id,
        value=payload.value,
        timestamp=payload.timestamp,
        created_at=now,
        updated_at=now,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@api.put("/api/wellbeing/{wellbeing_id}", response_model=schemas.WellbeingOut)
def update_wellbeing(wellbeing_id: int, payload: schemas.WellbeingUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.WellbeingEntry).filter(models.WellbeingEntry.id == wellbeing_id).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="Wohlbefinden nicht gefunden")

    target_user_id = resolve_user_id(db, payload.user_id if payload.user_id is not None else entry.user_id)
    entry.user_id = target_user_id
    entry.value = payload.value
    entry.timestamp = payload.timestamp
    entry.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(entry)
    return entry


@api.delete("/api/wellbeing/{wellbeing_id}")
def delete_wellbeing(wellbeing_id: int, db: Session = Depends(get_db)):
    entry = db.query(models.WellbeingEntry).filter(models.WellbeingEntry.id == wellbeing_id).first()
    if entry is None:
        raise HTTPException(status_code=404, detail="Wohlbefinden nicht gefunden")
    db.delete(entry)
    db.commit()
    return {"deleted": True, "wellbeing_id": wellbeing_id}


def build_reminder_entries_for_meal(meal: models.Meal):
    scheduled = [
        ("1h", meal.eaten_at + timedelta(hours=1)),
        ("4h", meal.eaten_at + timedelta(hours=4)),
    ]

    return [
        {
            "id": f"{meal.id}-{label}",
            "user_id": meal.user_id,
            "meal_id": meal.id,
            "reminder_type": label,
            "scheduled_at": scheduled_at,
            "status": "pending",
            "sent_at": None,
        }
        for label, scheduled_at in scheduled
    ]


@api.get("/api/reminders", response_model=List[schemas.ReminderOut])
def get_reminders(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Meal)
    if user_id is not None:
        query = query.filter(models.Meal.user_id == user_id)
    meals = query.order_by(models.Meal.eaten_at.asc()).all()
    reminders = []
    for meal in meals:
        reminders.extend(build_reminder_entries_for_meal(meal))
    return reminders


@api.post("/api/reminders", response_model=schemas.ReminderOut, status_code=status.HTTP_201_CREATED)
def create_reminder(db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Reminder-Logik wird im MVP noch ergänzt")


@api.get("/api/export/csv")
def export_csv(
    user_id: int | None = Query(default=None),
    export_type: str = Query(default="clinical"),
    db: Session = Depends(get_db),
):
    meals_query = db.query(models.Meal)
    symptoms_query = db.query(models.Symptom)
    wellbeing_query = db.query(models.WellbeingEntry)

    if user_id is not None:
        meals_query = meals_query.filter(models.Meal.user_id == user_id)
        symptoms_query = symptoms_query.filter(models.Symptom.user_id == user_id)
        wellbeing_query = wellbeing_query.filter(models.WellbeingEntry.user_id == user_id)

    meals = meals_query.order_by(models.Meal.eaten_at.desc()).all()
    symptoms = symptoms_query.order_by(models.Symptom.timestamp.desc()).all()
    wellbeing_entries = wellbeing_query.order_by(models.WellbeingEntry.timestamp.desc()).all()

    normalized_export_type = (export_type or "clinical").strip().lower()
    export_context = (
        "arzt_ernaehrungsberater"
        if normalized_export_type in {"clinical", "arzt", "berater", "doctor", "advisor", "nutrition"}
        else "standard"
    )
    filename = (
        "ernaehrungstagebuch-arzt-berater-export.csv"
        if export_context == "arzt_ernaehrungsberater"
        else "ernaehrungstagebuch-export.csv"
    )

    output = io.StringIO()
    writer = SafeCsvWriter(output)
    writer.writerow([
        "user_id",
        "username",
        "timestamp_local",
        "timestamp_utc",
        "timezone",
        "entry_type",
        "category",
        "sub_category",
        "name",
        "value",
        "unit",
        "notes",
        "created_at",
        "updated_at",
        "sync_status",
        "export_context",
    ])

    for meal in meals:
        writer.writerow([
            meal.user_id,
            meal.user.username if meal.user else "",
            isoformat_for_local_time(meal.eaten_at),
            isoformat_for_utc(meal.eaten_at),
            "Europe/Berlin",
            "meal",
            "nutrition",
            "meal",
            meal.name,
            "",
            "meal",
            meal.notes or "",
            isoformat_or_value(meal.created_at),
            isoformat_or_value(meal.updated_at),
            "synced",
            export_context,
        ])

    for symptom in symptoms:
        writer.writerow([
            symptom.user_id,
            symptom.user.username if symptom.user else "",
            isoformat_for_local_time(symptom.timestamp),
            isoformat_for_utc(symptom.timestamp),
            "Europe/Berlin",
            "symptom",
            "symptom",
            symptom.type,
            symptom.type,
            symptom.value,
            "scale_1_5",
            "",
            isoformat_or_value(symptom.created_at),
            isoformat_or_value(symptom.updated_at),
            "synced",
            export_context,
        ])

    for entry in wellbeing_entries:
        writer.writerow([
            entry.user_id,
            entry.user.username if entry.user else "",
            isoformat_for_local_time(entry.timestamp),
            isoformat_for_utc(entry.timestamp),
            "Europe/Berlin",
            "wellbeing",
            "wellbeing",
            "overall",
            "overall_wellbeing",
            entry.value,
            "scale_1_3",
            "",
            isoformat_or_value(entry.created_at),
            isoformat_or_value(entry.updated_at),
            "synced",
            export_context,
        ])

    content = output.getvalue()
    return Response(content=content, media_type="text/csv", headers={
        "Content-Disposition": f"attachment; filename={filename}"
    })


@api.post("/api/import/csv")
def import_csv(
    user_id: int | None = Query(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Keine CSV-Datei ausgewählt")

    if user_id is not None:
        resolve_user_id(db, user_id)

    raw_content = file.file.read(MAX_IMPORT_BYTES + 1)
    if len(raw_content) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="CSV-Datei ist zu groß (maximal 5 MB)")

    try:
        csv_content = raw_content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV-Datei ist kein UTF-8 Text")

    reader = csv.DictReader(io.StringIO(csv_content))
    if reader.fieldnames is None:
        raise HTTPException(status_code=400, detail="CSV-Datei ist leer oder ungültig")

    target_user_id = user_id
    imported = {"meals": 0, "symptoms": 0, "wellbeing": 0}

    try:
        for row_number, row in enumerate(reader, start=2):
            target_user_id = import_csv_row(db, row, target_user_id, imported, row_number)
    except HTTPException:
        db.rollback()
        raise

    db.commit()
    return {"imported": imported}


def import_csv_row(db: Session, raw_row: dict, target_user_id: int | None, imported: dict, row_number: int) -> int | None:
    row = {key: unescape_csv_formula(value) for key, value in raw_row.items() if key is not None}

    def fail(message: str):
        raise HTTPException(status_code=400, detail=f"CSV-Zeile {row_number}: {message}")

    def parse_int(raw_value: str, allowed: range) -> int:
        try:
            parsed = int(raw_value)
        except ValueError:
            fail(f"ungültiger Wert '{raw_value[:20]}'")
        if parsed not in allowed:
            fail(f"Wert {parsed} liegt außerhalb von {allowed.start}-{allowed.stop - 1}")
        return parsed

    def parse_timestamp(raw_value):
        try:
            return normalize_import_datetime(raw_value)
        except ValueError:
            fail("ungültiges Datum")

    def check_length(value: str, max_length: int, label: str) -> str:
        if len(value) > max_length:
            fail(f"{label} ist länger als {max_length} Zeichen")
        return value

    entry_type = (row.get("entry_type") or row.get("record_type") or "").strip().lower()
    if not entry_type:
        return target_user_id

    raw_user_id = (row.get("user_id") or "").strip()
    if target_user_id is None and raw_user_id:
        try:
            target_user_id = int(raw_user_id)
        except ValueError:
            fail("ungültige user_id")
        if db.query(models.User).filter(models.User.id == target_user_id).first() is None:
            fail(f"Benutzer {target_user_id} existiert nicht")

    if target_user_id is None:
        return target_user_id

    if entry_type == "meal":
        meal_name = check_length((row.get("name") or row.get("meal_name") or "").strip(), 255, "Name")
        if not meal_name:
            return target_user_id

        meal_timestamp = parse_timestamp(
            row.get("timestamp_local") or row.get("timestamp_utc") or row.get("meal_eaten_at")
        )
        raw_notes = check_length(row.get("notes") or row.get("meal_notes") or "", 2000, "Notiz")
        meal_notes = normalize_import_text(raw_notes)
        existing_meals = db.query(models.Meal).filter(
            models.Meal.user_id == target_user_id,
            models.Meal.name == meal_name,
            models.Meal.eaten_at == meal_timestamp,
        ).all()
        if any(is_normalized_match(meal.notes, meal_notes) for meal in existing_meals):
            return target_user_id

        meal = models.Meal(
            user_id=target_user_id,
            name=meal_name,
            eaten_at=meal_timestamp,
            notes=raw_notes or None,
            created_at=parse_import_metadata_datetime(row.get("created_at") or row.get("meal_created_at")),
            updated_at=parse_import_metadata_datetime(row.get("updated_at") or row.get("meal_updated_at")),
        )
        db.add(meal)
        imported["meals"] += 1

    elif entry_type == "symptom":
        symptom_type = check_length(
            (row.get("sub_category") or row.get("symptom_type") or row.get("name") or "").strip(), 50, "Symptom"
        )
        symptom_value_raw = (row.get("value") or row.get("symptom_value") or "").strip()
        if not symptom_type or not symptom_value_raw:
            return target_user_id

        symptom_timestamp = parse_timestamp(
            row.get("timestamp_local") or row.get("timestamp_utc") or row.get("symptom_timestamp")
        )
        symptom_value = parse_int(symptom_value_raw, SYMPTOM_VALUE_RANGE)
        existing_symptoms = db.query(models.Symptom).filter(
            models.Symptom.user_id == target_user_id,
            models.Symptom.value == symptom_value,
            models.Symptom.timestamp == symptom_timestamp,
        ).all()
        if any(is_normalized_match(symptom.type, symptom_type) for symptom in existing_symptoms):
            return target_user_id

        symptom = models.Symptom(
            user_id=target_user_id,
            type=symptom_type,
            value=symptom_value,
            timestamp=symptom_timestamp,
            created_at=parse_import_metadata_datetime(row.get("created_at") or row.get("symptom_created_at")),
            updated_at=parse_import_metadata_datetime(row.get("updated_at") or row.get("symptom_updated_at")),
        )
        db.add(symptom)
        imported["symptoms"] += 1

    elif entry_type == "wellbeing":
        wellbeing_value_raw = (row.get("value") or row.get("wellbeing_value") or "").strip()
        if not wellbeing_value_raw:
            return target_user_id

        wellbeing_timestamp = parse_timestamp(
            row.get("timestamp_local") or row.get("timestamp_utc") or row.get("wellbeing_timestamp")
        )
        wellbeing_value = parse_int(wellbeing_value_raw, WELLBEING_VALUE_RANGE)
        existing_wellbeing = db.query(models.WellbeingEntry).filter(
            models.WellbeingEntry.user_id == target_user_id,
            models.WellbeingEntry.value == wellbeing_value,
            models.WellbeingEntry.timestamp == wellbeing_timestamp,
        ).first()
        if existing_wellbeing is not None:
            return target_user_id

        entry = models.WellbeingEntry(
            user_id=target_user_id,
            value=wellbeing_value,
            timestamp=wellbeing_timestamp,
            created_at=parse_import_metadata_datetime(row.get("created_at") or row.get("wellbeing_created_at")),
            updated_at=parse_import_metadata_datetime(row.get("updated_at") or row.get("wellbeing_updated_at")),
        )
        db.add(entry)
        imported["wellbeing"] += 1

    return target_user_id


class SafeCsvWriter:
    """csv.writer that prefixes cells starting with formula characters, so that
    spreadsheet programs (Excel, LibreOffice) do not execute user-entered text."""

    def __init__(self, output):
        self._writer = csv.writer(output)

    def writerow(self, row):
        self._writer.writerow([escape_csv_formula(cell) for cell in row])


def escape_csv_formula(value):
    if isinstance(value, str) and value.startswith(CSV_FORMULA_PREFIXES):
        return "'" + value
    return value


def unescape_csv_formula(value):
    if isinstance(value, str) and value.startswith("'") and value[1:].startswith(CSV_FORMULA_PREFIXES):
        return value[1:]
    return value


def isoformat_for_local_time(value):
    if value is None:
        return ""
    parsed = value if isinstance(value, datetime) else parse_csv_datetime(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=None)
    return parsed.astimezone().isoformat() if parsed.tzinfo else parsed.isoformat()


def isoformat_for_utc(value):
    if value is None:
        return ""
    parsed = value if isinstance(value, datetime) else parse_csv_datetime(value)
    if parsed.tzinfo is None:
        return parsed.isoformat() + "+00:00"
    return parsed.astimezone(timezone.utc).isoformat()


def parse_csv_datetime(value):
    if value is None or value == "":
        return datetime.utcnow()

    if isinstance(value, datetime):
        return value

    normalized = str(value).strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"

    return datetime.fromisoformat(normalized)


def parse_import_metadata_datetime(value):
    # created_at/updated_at are informational; fall back to now instead of failing the import
    try:
        return parse_csv_datetime(value)
    except ValueError:
        return datetime.utcnow()


def normalize_import_datetime(value):
    parsed = parse_csv_datetime(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def normalize_import_text(value):
    return (value or "").strip().lower()


def is_normalized_match(left, right):
    return normalize_import_text(left) == normalize_import_text(right)


def isoformat_or_value(value):
    return value.isoformat() if hasattr(value, "isoformat") else value


app.include_router(api)
