from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes_jobs import router as jobs_router

app = FastAPI(
    title="API Document Management",
    description="API de traitement de documents asynchrone",
    version="1.0.0"
)

# Configuration CORS pour autoriser le Frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(jobs_router)

@app.get("/")
def health_check():
    return {"status": "ok", "service": "document-api"}
