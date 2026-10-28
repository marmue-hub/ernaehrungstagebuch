from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class InputModel(BaseModel):
    # Strip surrounding whitespace; unknown fields (e.g. "id" from queued offline updates) are ignored
    model_config = ConfigDict(str_strip_whitespace=True)


class LoginIn(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


class LoginOut(BaseModel):
    token: str


class UserCreate(InputModel):
    username: str = Field(..., min_length=2, max_length=100)


class UserUpdate(InputModel):
    username: str = Field(..., min_length=2, max_length=100)
    display_name: Optional[str] = Field(default=None, max_length=100)


class UserOut(BaseModel):
    id: int
    username: str
    display_name: Optional[str] = None
    created_at: datetime


class MealCreate(InputModel):
    user_id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    eaten_at: datetime
    notes: Optional[str] = Field(default=None, max_length=2000)


class MealUpdate(InputModel):
    user_id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    eaten_at: datetime
    notes: Optional[str] = Field(default=None, max_length=2000)


class MealOut(BaseModel):
    id: int
    user_id: int
    name: str
    eaten_at: datetime
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class SymptomCreate(InputModel):
    user_id: Optional[int] = None
    meal_id: Optional[int] = None
    type: str = Field(..., min_length=1, max_length=50)
    value: int = Field(..., ge=1, le=5)
    timestamp: datetime


class SymptomUpdate(InputModel):
    user_id: Optional[int] = None
    meal_id: Optional[int] = None
    type: str = Field(..., min_length=1, max_length=50)
    value: int = Field(..., ge=1, le=5)
    timestamp: datetime


class SymptomOut(BaseModel):
    id: int
    user_id: int
    meal_id: Optional[int]
    type: str
    value: int
    timestamp: datetime
    created_at: datetime
    updated_at: datetime


class WellbeingCreate(InputModel):
    user_id: Optional[int] = None
    value: int = Field(..., ge=1, le=3)
    timestamp: datetime


class WellbeingUpdate(InputModel):
    user_id: Optional[int] = None
    value: int = Field(..., ge=1, le=3)
    timestamp: datetime


class WellbeingOut(BaseModel):
    id: int
    user_id: int
    value: int
    timestamp: datetime
    created_at: datetime
    updated_at: datetime


class ReminderOut(BaseModel):
    id: str
    user_id: int
    meal_id: int
    reminder_type: str
    scheduled_at: datetime
    status: str
    sent_at: Optional[datetime] = None
