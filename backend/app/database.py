from sqlalchemy import inspect, text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.effective_database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def ensure_schema():
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    required_columns = {
        "meals": [("created_at", "DATETIME"), ("updated_at", "DATETIME")],
        "symptoms": [("created_at", "DATETIME"), ("updated_at", "DATETIME")],
        "wellbeing_entries": [("created_at", "DATETIME"), ("updated_at", "DATETIME")],
    }

    with engine.begin() as connection:
        for table_name, columns in required_columns.items():
            if table_name not in table_names:
                continue

            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, column_type in columns:
                if column_name in existing_columns:
                    continue
                connection.execute(
                    text(f'ALTER TABLE "{table_name}" ADD COLUMN "{column_name}" {column_type}')
                )


ensure_schema()
