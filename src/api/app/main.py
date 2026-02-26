from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routes_jobs import router as jobs_router

app = FastAPI(
    title="Doc processing API",
    description="API de génération de documents",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "https://ton-app-frontend.azurewebsites.net",  # Ajoute l'URL de ton frontend Azure plus tard
    ],
    allow_credentials=False,
    allow_methods=["*"],  # Autorise GET, POST, PUT, OPTIONS, etc.
    allow_headers=["*"],  # Autorise tous les headers (Content-Type, etc.)
)

app.include_router(jobs_router)


@app.get("/health")
def health():
    return {"status": "ok"}
