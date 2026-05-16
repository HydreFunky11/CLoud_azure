import json
from functools import lru_cache
from openai import APIError, OpenAI, RateLimitError

from .config import settings


def openai_error_message(exc: Exception) -> str:
    if isinstance(exc, RateLimitError):
        return "Trop de requêtes OpenAI. Réessayez dans quelques instants."
    if isinstance(exc, APIError):
        body = getattr(exc, "body", None) or {}
        err = body.get("error", {}) if isinstance(body, dict) else {}
        code = err.get("code") if isinstance(err, dict) else None
        if code == "insufficient_quota" or exc.status_code == 429:
            return (
                "Quota OpenAI dépassé. Vérifiez votre plan et la facturation sur "
                "https://platform.openai.com/account/billing"
            )
    msg = str(exc)
    if "insufficient_quota" in msg:
        return (
            "Quota OpenAI dépassé. Vérifiez votre plan et la facturation sur "
            "https://platform.openai.com/account/billing"
        )
    return "Erreur lors de l'analyse OpenAI."


@lru_cache
def get_openai_client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def extract_tags_from_text(text: str, file_name: str) -> list[str]:
    client = get_openai_client()
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "Tu classes des documents. Réponds UNIQUEMENT avec un tableau JSON "
                    'de tags courts (max 8), ex: ["pdf", "facture"].'
                ),
            },
            {
                "role": "user",
                "content": f"Fichier: {file_name}\n\n{text[:8000]}",
            },
        ],
        temperature=0.2,
    )
    raw = (response.choices[0].message.content or "[]").strip()
    try:
        tags = json.loads(raw)
        return [str(t) for t in tags][:8] if isinstance(tags, list) else []
    except json.JSONDecodeError:
        return []


def summarize_document(text: str) -> str:
    client = get_openai_client()
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=[
            {"role": "system", "content": "Résume ce document en 2-3 phrases en français."},
            {"role": "user", "content": text[:12000]},
        ],
        max_tokens=300,
    )
    return response.choices[0].message.content or ""


_TEXT_EXTENSIONS = (".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log")


def extract_document_text(content: bytes, file_name: str) -> str:
    if not file_name.lower().endswith(_TEXT_EXTENSIONS):
        return ""
    return content.decode("utf-8", errors="replace")[:50000]