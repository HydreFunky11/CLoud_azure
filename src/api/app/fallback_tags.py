"""Tagging par règles (fallback si l'appel IA échoue ou renvoie un JSON invalide)."""

_KEYWORDS_MAP = {
    "cv": ["cv", "rh"],
    "facture": ["facture", "comptabilite"],
    "contrat": ["contrat", "administratif"],
    "azure": ["azure", "cloud"],
    "docker": ["docker", "devops"],
    "pancake": ["recette", "cuisine"],
    "cuisine": ["cuisine", "recette"],
}


def tags_from_rules(file_name: str) -> list[str]:
    name = file_name.lower()
    tags: set[str] = set()

    if name.endswith(".pdf"):
        tags.update(["pdf", "document"])
    elif name.endswith(".docx"):
        tags.update(["word", "document"])
    elif name.endswith((".png", ".jpg", ".jpeg", ".gif")):
        tags.add("image")
    elif name.endswith((".md", ".txt", ".csv")):
        tags.add("texte")

    for key, values in _KEYWORDS_MAP.items():
        if key in name:
            tags.update(values)

    # Segments du nom (cv_amine_azure → cv, amine, azure)
    stem = name.rsplit(".", 1)[0] if "." in name else name
    for part in stem.replace("-", "_").split("_"):
        part = part.strip()
        if len(part) >= 2:
            tags.add(part)

    if len(tags) < 3:
        tags.update(["document", "fichier"])

    return sorted(tags)[:8]
