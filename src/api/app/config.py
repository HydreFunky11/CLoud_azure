from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", 
        env_file_encoding="utf_8", 
        extra="ignore", 
        populate_by_name=True
    )

    # On rend tout optionnel pour éviter le crash AZFD0005 au démarrage
    cosmos_endpoint: Optional[str] = None
    cosmos_key: Optional[str] = None
    cosmos_database: str = "db-doc"
    cosmos_container: str = "jobs"
    
    blob_connection_string: Optional[str] = None
    blob_container: str = "doc-storage"
    
    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = "gpt-4o-mini"

settings = Settings()
