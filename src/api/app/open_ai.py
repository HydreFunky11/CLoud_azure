import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal, Optional

from openai import APIError, OpenAI, RateLimitError

from .config import settings
from .fallback_tags import tags_from_rules

TaggingSource = Literal["openai", "fallback"]

MIN_TAGS = 3
MAX_TAGS = 8


@dataclass
class TaggingResult:
    tags: list[str]
    source: TaggingSource
    warning: Optional[str] = None


def openai_error_message(exc: Exception) -> str:
    if isinstance(exc, RateLimitError):
        return "Trop de requêtes OpenAI. Réessayez dans quelques instants."
    if isinstance(exc, APIError):
        body = getattr(exc, "body", None) or {}
        err = body.get("error", {}) if isinstance(body, dict) else {}
        code = err.get("code") if isinstance(err, dict) else None
        status = getattr(exc, "status_code", None)
        if code == "insufficient_quota" or status == 429:
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


def parse_json_tags(raw: str) -> Optional[list[str]]:
    """Parse une réponse IA en liste de 3 à 8 tags, ou None si invalide."""
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```\s*$", "", text).strip()

    candidates = [text]
    array_match = re.search(r"\[[\s\S]*\]", text)
    if array_match:
        candidates.append(array_match.group(0))

    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if not isinstance(data, list):
            continue
        tags = [str(t).strip().lower() for t in data if str(t).strip()]
        if MIN_TAGS <= len(tags) <= MAX_TAGS:
            return tags
        if len(tags) > MAX_TAGS:
            return tags[:MAX_TAGS]
    return None


def _build_tagging_messages(file_name: str, document_text: str) -> list[dict]:
    user_prompt = (
        "Analyse le nom de fichier suivant et génère entre 3 et 8 tags courts en français.\n"
        f"Nom du fichier : {file_name}\n\n"
        "Retourne uniquement un tableau JSON de chaînes."
    )
    if document_text.strip():
        user_prompt += f"\n\nContenu du document (extrait) :\n{document_text[:8000]}"

    return [
        {
            "role": "system",
            "content": (
                "Tu es un assistant de classification documentaire. "
                "Tu réponds uniquement avec un tableau JSON valide de chaînes, sans markdown ni texte autour."
            ),
        },
        {"role": "user", "content": user_prompt},
    ]


def _call_openai_tagging(file_name: str, document_text: str) -> list[str]:
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY non configurée")

    client = get_openai_client()
    response = client.chat.completions.create(
        model=settings.openai_model,
        messages=_build_tagging_messages(file_name, document_text),
        temperature=0.2,
    )
    raw = (response.choices[0].message.content or "").strip()
    tags = parse_json_tags(raw)
    if tags is None:
        raise ValueError(f"Réponse OpenAI non conforme (JSON 3-8 tags attendu): {raw[:200]}")
    return tags


def resolve_tags(file_name: str, document_text: str = "") -> TaggingResult:
    """IA obligatoire en priorité ; fallback par règles si échec ou JSON invalide."""
    warning: Optional[str] = None
    try:
        tags = _call_openai_tagging(file_name, document_text)
        return TaggingResult(tags=tags, source="openai")
    except Exception as e:
        warning = openai_error_message(e)

    fallback = tags_from_rules(file_name)
    return TaggingResult(tags=fallback, source="fallback", warning=warning)


def extract_tags_from_text(text: str, file_name: str) -> list[str]:
    """Compatibilité : retourne uniquement les tags."""
    return resolve_tags(file_name, text).tags


_TEXT_EXTENSIONS = (".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log")


def extract_document_text(content: bytes, file_name: str) -> str:
    if not file_name.lower().endswith(_TEXT_EXTENSIONS):
        return ""
    return content.decode("utf-8", errors="replace")[:50000]
