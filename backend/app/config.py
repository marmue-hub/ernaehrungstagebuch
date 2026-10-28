from pydantic_settings import BaseSettings, SettingsConfigDict


# Publicly visible in the repository: set an own APP_PASSWORD on the server
DEFAULT_APP_PASSWORD = "wiegehts"


class Settings(BaseSettings):
    app_name: str = "Ernährungstagebuch"
    app_env: str = "development"
    database_url: str = "sqlite:///./app.db"
    test_database_url: str | None = None
    production_database_url: str | None = None
    # Shared app password. Overridden by APP_PASSWORD; an empty value disables the login
    # (only allowed outside production)
    app_password: str | None = DEFAULT_APP_PASSWORD
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost,http://wiegehts.x73.eu,https://wiegehts.x73.eu,https://www.wiegehts.x73.eu"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def effective_database_url(self) -> str:
        environment = (self.app_env or "development").lower()

        if environment == "test" and self.test_database_url:
            return self.test_database_url

        if environment == "production" and self.production_database_url:
            return self.production_database_url

        return self.database_url


settings = Settings()
