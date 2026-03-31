from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "CoT Prompt Lab"
    DATA_ROOT: Path = Path("data")
    PROMPTS_DIR: Path = Path("prompts")
    STORAGE_DIR: Path = Path("storage")
    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: Optional[str] = None
    GOOGLE_API_KEY: Optional[str] = None
    GOOGLE_OPENAI_BASE_URL: str = (
        "https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    LANGCHAIN_TRACING_V2: Optional[str] = None
    LANGCHAIN_ENDPOINT: Optional[str] = None
    LANGSMITH_API_KEY: Optional[str] = None
    LANGCHAIN_PROJECT: Optional[str] = None
    DATABRICKS_HOST: Optional[str] = None
    DATABRICKS_HTTP_PATH: Optional[str] = None
    DATABRICKS_TOKEN: Optional[str] = None
    DATABRICKS_CATALOG: Optional[str] = None
    DATABRICKS_SCHEMA: Optional[str] = None
    HF_API_TOKEN: Optional[str] = None
    DATA_BASIC_INFO_DIR: str = "basic_info"
    DATA_IMS_INFO_DIR: str = "ims_info"
    DATA_HOST_INFO_DIR: str = "host_info"
    DATA_INITIAL_INTO_DIR: str = "initial_into"
    DATA_DUMP_INFO_DIR: str = "dump_info"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def templates_dir(self) -> Path:
        return Path(__file__).resolve().parent / "templates"

    @property
    def static_dir(self) -> Path:
        return Path(__file__).resolve().parent / "static"

    @property
    def system_prompt_path(self) -> Path:
        return self.PROMPTS_DIR / "base" / "system.md"

    @property
    def user_prompt_path(self) -> Path:
        return self.PROMPTS_DIR / "base" / "user.md"

    @property
    def prompt_history_path(self) -> Path:
        return self.STORAGE_DIR / "prompt_history.jsonl"

    @property
    def section_dirs(self) -> Dict[str, Path]:
        return {
            "basic_info": self.DATA_ROOT / self.DATA_BASIC_INFO_DIR,
            "ims_info": self.DATA_ROOT / self.DATA_IMS_INFO_DIR,
            "host_info": self.DATA_ROOT / self.DATA_HOST_INFO_DIR,
            "initial_into": self.DATA_ROOT / self.DATA_INITIAL_INTO_DIR,
            "dump_info": self.DATA_ROOT / self.DATA_DUMP_INFO_DIR,
        }

    @property
    def resolved_llm_provider(self) -> str:
        provider = (self.LLM_PROVIDER or "openai").strip().lower()
        if provider in {"openai", "google"}:
            return provider
        raise ValueError(f"Unsupported LLM_PROVIDER: {self.LLM_PROVIDER}")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
