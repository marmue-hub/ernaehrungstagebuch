import csv
import io
from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
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
def export_csv(user_id: int | None = Query(default=None), db: Session = Depends(get_db)):
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

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "record_type",
        "id",
        "user_id",
        "meal_name",
        "meal_eaten_at",
        "meal_notes",
        "meal_created_at",
        "meal_updated_at",
        "symptom_type",
        "symptom_value",
        "symptom_timestamp",
        "symptom_created_at",
        "symptom_updated_at",
        "wellbeing_value",
        "wellbeing_timestamp",
        "wellbeing_created_at",
        "wellbeing_updated_at",
    ])

    for meal in meals:
        writer.writerow([
            "meal",
            meal.id,
            meal.user_id,
            meal.name,
            isoformat_or_value(meal.eaten_at),
            meal.notes or "",
            isoformat_or_value(meal.created_at),
            isoformat_or_value(meal.updated_at),
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
        ])

    for symptom in symptoms:
        writer.writerow([
            "symptom",
            symptom.id,
            symptom.user_id,
            "",
            "",
            "",
            "",
            "",
            symptom.type,
            symptom.value,
            isoformat_or_value(symptom.timestamp),
            isoformat_or_value(symptom.created_at),
            isoformat_or_value(symptom.updated_at),
            "",
            "",
            "",
            "",
        ])

    for entry in wellbeing_entries:
        writer.writerow([
            "wellbeing",
            entry.id,
            entry.user_id,
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            "",
            entry.value,
            isoformat_or_value(entry.timestamp),
            isoformat_or_value(entry.created_at),
            isoformat_or_value(entry.updated_at),
        ])

    content = output.getvalue()
    return Response(content=content, media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=ernaehrungstagebuch-export.csv"
    })


def isoformat_or_value(value):
    return value.isoformat() if hasattr(value, "isoformat") else value
