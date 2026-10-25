import csv
import io
from datetime import datetime, timedelta, timezone
from typing import List

from fastapi import Depends, FastAPI, File, HTTPException, Query, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, engine
from app import models, schemas
from app.database import Base

Base.metadata.create_all(bind=engine)

app = FastAPI(title=settings.app_name)

origins = [
    origin.strip()
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.get("/health")
def health_check():
    return {"status": "ok", "app": settings.app_name}


@app.get("/api/users", response_model=List[schemas.UserOut])
def get_users(db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    return users


@app.post("/api/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Benutzername bereits vorhanden")

    user = models.User(
        username=payload.username,
        display_name=payload.username,
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


@app.get("/api/meals", response_model=List[schemas.MealOut])
def get_meals(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Meal)
    if user_id is not None:
        query = query.filter(models.Meal.user_id == user_id)
    return query.order_by(models.Meal.eaten_at.desc()).all()


@app.post("/api/meals", response_model=schemas.MealOut, status_code=status.HTTP_201_CREATED)
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


@app.get("/api/symptoms", response_model=List[schemas.SymptomOut])
def get_symptoms(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Symptom)
    if user_id is not None:
        query = query.filter(models.Symptom.user_id == user_id)
    return query.order_by(models.Symptom.timestamp.desc()).all()


@app.post("/api/symptoms", response_model=schemas.SymptomOut, status_code=status.HTTP_201_CREATED)
def create_symptom(payload: schemas.SymptomCreate, db: Session = Depends(get_db)):
    user_id = resolve_user_id(db, payload.user_id)
    now = datetime.utcnow()
    symptom = models.Symptom(
        user_id=user_id,
        meal_id=payload.meal_id,
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


@app.get("/api/wellbeing", response_model=List[schemas.WellbeingOut])
def get_wellbeing(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.WellbeingEntry)
    if user_id is not None:
        query = query.filter(models.WellbeingEntry.user_id == user_id)
    return query.order_by(models.WellbeingEntry.timestamp.desc()).all()


@app.post("/api/wellbeing", response_model=schemas.WellbeingOut, status_code=status.HTTP_201_CREATED)
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


@app.get("/api/reminders", response_model=List[schemas.ReminderOut])
def get_reminders(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
    query = db.query(models.Meal)
    if user_id is not None:
        query = query.filter(models.Meal.user_id == user_id)
    meals = query.order_by(models.Meal.eaten_at.asc()).all()
    reminders = []
    for meal in meals:
        reminders.extend(build_reminder_entries_for_meal(meal))
    return reminders


@app.post("/api/reminders", response_model=schemas.ReminderOut, status_code=status.HTTP_201_CREATED)
def create_reminder(db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Reminder-Logik wird im MVP noch ergänzt")


@app.get("/api/export/csv")
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
    writer = csv.writer(output)
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


@app.post("/api/import/csv")
def import_csv(
    user_id: int | None = Query(default=None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Keine CSV-Datei ausgewählt")

    try:
        csv_content = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="CSV-Datei ist kein UTF-8 Text")

    reader = csv.DictReader(io.StringIO(csv_content))
    if reader.fieldnames is None:
        raise HTTPException(status_code=400, detail="CSV-Datei ist leer oder ungültig")

    target_user_id = user_id
    imported = {"meals": 0, "symptoms": 0, "wellbeing": 0}

    for row in reader:
        entry_type = (row.get("entry_type") or row.get("record_type") or "").strip().lower()
        if not entry_type:
            continue

        raw_user_id = (row.get("user_id") or "").strip()
        if target_user_id is None and raw_user_id:
            target_user_id = int(raw_user_id)

        if target_user_id is None:
            continue

        if entry_type == "meal":
            meal_name = (row.get("name") or row.get("meal_name") or "").strip()
            if not meal_name:
                continue

            meal = models.Meal(
                user_id=target_user_id,
                name=meal_name,
                eaten_at=parse_csv_datetime(row.get("timestamp_local") or row.get("timestamp_utc") or row.get("meal_eaten_at")),
                notes=(row.get("notes") or row.get("meal_notes") or "") or None,
                created_at=parse_csv_datetime(row.get("created_at") or row.get("meal_created_at")),
                updated_at=parse_csv_datetime(row.get("updated_at") or row.get("meal_updated_at")),
            )
            db.add(meal)
            imported["meals"] += 1

        elif entry_type == "symptom":
            symptom_type = (row.get("sub_category") or row.get("symptom_type") or row.get("name") or "").strip()
            symptom_value_raw = (row.get("value") or row.get("symptom_value") or "").strip()
            if not symptom_type or not symptom_value_raw:
                continue

            symptom = models.Symptom(
                user_id=target_user_id,
                type=symptom_type,
                value=int(symptom_value_raw),
                timestamp=parse_csv_datetime(row.get("timestamp_local") or row.get("timestamp_utc") or row.get("symptom_timestamp")),
                created_at=parse_csv_datetime(row.get("created_at") or row.get("symptom_created_at")),
                updated_at=parse_csv_datetime(row.get("updated_at") or row.get("symptom_updated_at")),
            )
            db.add(symptom)
            imported["symptoms"] += 1

        elif entry_type == "wellbeing":
            wellbeing_value_raw = (row.get("value") or row.get("wellbeing_value") or "").strip()
            if not wellbeing_value_raw:
                continue

            entry = models.WellbeingEntry(
                user_id=target_user_id,
                value=int(wellbeing_value_raw),
                timestamp=parse_csv_datetime(row.get("timestamp_local") or row.get("timestamp_utc") or row.get("wellbeing_timestamp")),
                created_at=parse_csv_datetime(row.get("created_at") or row.get("wellbeing_created_at")),
                updated_at=parse_csv_datetime(row.get("updated_at") or row.get("wellbeing_updated_at")),
            )
            db.add(entry)
            imported["wellbeing"] += 1

    db.commit()
    return {"imported": imported}


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


def isoformat_or_value(value):
    return value.isoformat() if hasattr(value, "isoformat") else value
