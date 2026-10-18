"""Application configuration loaded from environment variables."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Voice AI Problem Intake Agent"
    app_version: str = "0.1.0"
    app_env: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = True
    database_url: str = "sqlite:///./data/sessions.db"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.8-flash"
    sarvam_api_key: str | None = None
    sarvam_stt_model: str = "saaras:v4"
    sarvam_tts_model: str = "bulbul:v4-flash"
    sarvam_tts_voice: str = "shubh_enhi_ads"
    api_auth_enabled: bool = True
    session_token_ttl_hours: int = Field(default=24, ge=1, le=720)
    rate_limit_requests_per_minute: int = Field(default=120, ge=1)
    rate_limit_session_creation_per_hour: int = Field(default=20, ge=1)
    max_audio_upload_bytes: int = Field(default=10_000_000, ge=1, le=100_000_000)
    otel_service_name: str = "paytm-ai-backend"
    otel_exporter_otlp_endpoint: str | None = None
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )


settings = Settings()
