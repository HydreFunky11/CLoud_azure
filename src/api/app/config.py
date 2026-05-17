from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf_8", extra="ignore", populate_by_name=True
    )

    cosmos_endpoint: str
    cosmos_key: str
    cosmos_database: str = "db-doc"
    cosmos_container: str = "jobs"
    blob_connection_string: str
    blob_container: str
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = "gpt-4o-mini"


settings = Settings()
