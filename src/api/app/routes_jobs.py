from azure.core.exceptions import ResourceNotFoundError
from azure.cosmos.exceptions import CosmosHttpResponseError
from fastapi import APIRouter, HTTPException

from .blob_service import download_blob, generate_upload_sas
from .cosmos import get_cosmos_container
from .models import JobCreateRequest, JobCreateResponse, job_to_entity, now_iso
from .open_ai import extract_document_text, extract_tags_from_text, openai_error_message

router = APIRouter(prefix="/jobs", tags=["jobs"])


def _persist_tagging_failure(container, item: dict, job_id: str, message: str) -> None:
    item["status"] = "UPLOADED"
    item["error"] = message
    item["updatedAt"] = now_iso()
    container.replace_item(item=job_id, body=item)


@router.post("", response_model=JobCreateResponse, status_code=201)
def create_job(req: JobCreateRequest):
    container = get_cosmos_container()
    entity = job_to_entity(req)

    try:
        container.create_item(body=entity)
    except CosmosHttpResponseError as e:
        raise HTTPException(
            status_code=500, detail=f"Cosmos error: {getattr(e, 'message', str(e))}"
        )

    blob_path = f"input/{entity['id']}/{req.fileName}"

    upload_url = generate_upload_sas(blob_path)

    return JobCreateResponse(
        jobId=entity["id"],
        status=entity["status"],
        createdAt=entity["createdAt"],
        uploadUrl=upload_url,
        type=entity["type"],
    )


@router.get("", summary="Lister tous les jobs")
@router.get("/", summary="Lister tous les jobs (slash)")
def list_jobs():
    container = get_cosmos_container()
    try:
        # On récupère tous les items ayant la partition key "JOB"
        items = list(container.query_items(
            query="SELECT * FROM c WHERE c.pk = 'JOB' ORDER BY c.createdAt DESC",
            enable_cross_partition_query=True
        ))
        return items
    except CosmosHttpResponseError as e:
        raise HTTPException(
            status_code=500, detail=f"Cosmos error: {getattr(e, 'message', str(e))}"
        )


@router.get(
    "/{job_id}",
    summary="Récupérer un job par ID",
    description="Récupérer un job complet par ID. 404 si il n'existe pas.",
)
def get_job(job_id: str):
    container = get_cosmos_container()
    try:
        item = container.read_item(item=job_id, partition_key="JOB")
        return item
    except CosmosHttpResponseError as e:
        if getattr(e, "status_code", None) == 404:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(
            status_code=500, detail=f"Cosmos error: {getattr(e, 'message', str(e))}"
        )

@router.post("/{job_id}/tags", summary="Extraire les tags d'un document")
def extract_tags(job_id: str):
    container = get_cosmos_container()
    try:
        item = container.read_item(item=job_id, partition_key="JOB")
    except CosmosHttpResponseError as e:
        if getattr(e, "status_code", None) == 404:
            raise HTTPException(status_code=404, detail="Job not found")
        raise HTTPException(
            status_code=500, detail=f"Cosmos error: {getattr(e, 'message', str(e))}"
        )

    file_name = item.get("fileName", "")
    blob_path = f"input/{job_id}/{file_name}"

    try:
        content = download_blob(blob_path)
    except ResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Document file not found in storage")

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    text = extract_document_text(content, file_name)
    try:
        tags = extract_tags_from_text(text, file_name)
    except Exception as e:
        message = openai_error_message(e)
        try:
            _persist_tagging_failure(container, item, job_id, message)
        except CosmosHttpResponseError as cosmos_err:
            raise HTTPException(
                status_code=500,
                detail=f"Cosmos error: {getattr(cosmos_err, 'message', str(cosmos_err))}",
            )
        raise HTTPException(
            status_code=502,
            detail={
                "step": "openai",
                "message": message,
                "jobId": job_id,
                "fileName": file_name,
                "jobCreated": True,
                "fileUploaded": True,
            },
        )

    ts = now_iso()
    item["tags"] = tags
    item["error"] = None
    item["updatedAt"] = ts
    item["processedAt"] = ts
    item["status"] = "PROCESSED"

    try:
        container.replace_item(item=job_id, body=item)
    except CosmosHttpResponseError as e:
        raise HTTPException(
            status_code=500, detail=f"Cosmos error: {getattr(e, 'message', str(e))}"
        )

    return item
