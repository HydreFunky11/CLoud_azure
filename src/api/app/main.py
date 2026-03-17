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
    allow_origins=["*"],  # Temporaire pour debug
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)


@app.get("/health")
def health():
    return {"status": "ok"}
