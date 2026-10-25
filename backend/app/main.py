import csv
import io
from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, HTTPException, Response, status
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


@app.get("/api/meals", response_model=List[schemas.MealOut])
def get_meals(db: Session = Depends(get_db)):
    return db.query(models.Meal).order_by(models.Meal.eaten_at.desc()).all()


@app.post("/api/meals", response_model=schemas.MealOut, status_code=status.HTTP_201_CREATED)
def create_meal(payload: schemas.MealCreate, db: Session = Depends(get_db)):
    now = datetime.utcnow()
    meal = models.Meal(
        user_id=1,
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
def get_symptoms(db: Session = Depends(get_db)):
    return db.query(models.Symptom).order_by(models.Symptom.timestamp.desc()).all()


@app.post("/api/symptoms", response_model=schemas.SymptomOut, status_code=status.HTTP_201_CREATED)
def create_symptom(payload: schemas.SymptomCreate, db: Session = Depends(get_db)):
    symptom = models.Symptom(
        user_id=1,
        meal_id=payload.meal_id,
        type=payload.type,
        value=payload.value,
        timestamp=payload.timestamp,
    )
    db.add(symptom)
    db.commit()
    db.refresh(symptom)
    return symptom


@app.get("/api/wellbeing", response_model=List[schemas.WellbeingOut])
def get_wellbeing(db: Session = Depends(get_db)):
    return db.query(models.WellbeingEntry).order_by(models.WellbeingEntry.timestamp.desc()).all()


@app.post("/api/wellbeing", response_model=schemas.WellbeingOut, status_code=status.HTTP_201_CREATED)
def create_wellbeing(payload: schemas.WellbeingCreate, db: Session = Depends(get_db)):
    entry = models.WellbeingEntry(
        user_id=1,
        value=payload.value,
        timestamp=payload.timestamp,
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
def get_reminders(db: Session = Depends(get_db)):
    meals = db.query(models.Meal).order_by(models.Meal.eaten_at.asc()).all()
    reminders = []
    for meal in meals:
        reminders.extend(build_reminder_entries_for_meal(meal))
    return reminders


@app.post("/api/reminders", response_model=schemas.ReminderOut, status_code=status.HTTP_201_CREATED)
def create_reminder(db: Session = Depends(get_db)):
    raise HTTPException(status_code=501, detail="Reminder-Logik wird im MVP noch ergänzt")


@app.get("/api/export/csv")
def export_csv(db: Session = Depends(get_db)):
    meals = db.query(models.Meal).order_by(models.Meal.eaten_at.desc()).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "name", "eaten_at", "notes", "created_at", "updated_at"])

    for meal in meals:
        writer.writerow([
            meal.id,
            meal.name,
            meal.eaten_at.isoformat() if hasattr(meal.eaten_at, "isoformat") else meal.eaten_at,
            meal.notes or "",
            meal.created_at.isoformat() if hasattr(meal.created_at, "isoformat") else meal.created_at,
            meal.updated_at.isoformat() if hasattr(meal.updated_at, "isoformat") else meal.updated_at,
        ])

    content = output.getvalue()
    return Response(content=content, media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=ernaehrungstagebuch-export.csv"
    })
