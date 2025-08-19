# Pydantic BaseSettings（ENV対応）

# services/api/app/core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_env: str = "dev"
    database_url: str = "sqlite+aiosqlite:///./dev.db"  # Alembicで同期に置換するのでOK
    openai_api_key: str | None = None                   # ここはNone許容で安全
    jwt_secret: str = "change-me"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="",
        case_sensitive=False,
    )

# ← これが無いと今回のImportErrorになる
settings = Settings()
