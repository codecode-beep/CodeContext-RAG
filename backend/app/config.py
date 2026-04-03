from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Always load backend/.env even if uvicorn’s cwd is the repo root
_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_DIR / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Google AI Studio: https://aistudio.google.com/apikey
    google_api_key: str = ""
    # Must support embedContent — use gemini-embedding-001 (not legacy text-embedding-* IDs)
    # https://ai.google.dev/gemini-api/docs/models/gemini-embedding-001
    google_embedding_model: str = "gemini-embedding-001"
    # Quotas are per model on the free tier — switch if you hit 429 (e.g. gemini-1.5-flash)
    google_chat_model: str = "gemini-2.5-flash"
    default_top_k: int = 5
    max_upload_mb: int = 10


settings = Settings()


def gemini_is_configured() -> bool:
    return bool(settings.google_api_key and settings.google_api_key.strip())
