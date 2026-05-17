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

    # On utilise les noms en MAJUSCULES pour correspondre au portail Azure
    cosmos_endpoint: Optional[str] = Field(default=None, alias="COSMOS_ENDPOINT")
    cosmos_key: Optional[str] = Field(default=None, alias="COSMOS_KEY")
    cosmos_database: str = Field(default="db-doc", alias="COSMOS_DATABASE")
    cosmos_container: str = Field(default="jobs", alias="COSMOS_CONTAINER")
    
    blob_connection_string: Optional[str] = Field(default=None, alias="BLOB_CONNECTION_STRING")
    blob_container: str = Field(default="doc-storage", alias="BLOB_CONTAINER")
    
    openai_api_key: Optional[str] = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = "gpt-4o-mini"

settings = Settings()
