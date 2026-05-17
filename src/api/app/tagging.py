from azure.core.exceptions import ResourceNotFoundError
from azure.cosmos.exceptions import CosmosHttpResponseError
from fastapi import HTTPException

from .blob_service import download_blob
from .open_ai import extract_document_text, resolve_tags
from .models import now_iso


def apply_openai_tags(container, job_id: str, item: dict) -> dict:
    """Télécharge le blob, tague via IA (OpenAI) avec fallback règles, met à jour Cosmos."""
    file_name = item.get("fileName", "")
    blob_path = f"input/{job_id}/{file_name}"

    try:
        content = download_blob(blob_path)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Document file not found in storage")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    text = extract_document_text(content, file_name)
    result = resolve_tags(file_name, text)

    ts = now_iso()
    item["tags"] = result.tags
    item["taggingSource"] = result.source
    item["status"] = "PROCESSED"
    item["processedAt"] = ts
    item["updatedAt"] = ts
    if result.warning:
        item["error"] = f"Tagging fallback ({result.source}) : {result.warning}"
    else:
        item["error"] = None

    try:
        container.replace_item(item=job_id, body=item)
    except CosmosHttpResponseError as e:
        raise HTTPException(
            status_code=500, detail=f"Cosmos error: {getattr(e, 'message', str(e))}"
        )

    return item
