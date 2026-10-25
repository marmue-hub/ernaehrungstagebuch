from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Ernährungstagebuch"
    database_url: str = "postgresql://app:secret@postgres:5432/ernaehrungstagebuch"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://wiegehts.x73.eu"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
