import logging

import azure.functions as func
from app.cosmos import get_cosmos_container

app = func.FunctionApp()


@app.blob_trigger(
    arg_name="myblob",
    path="doc-storage/input/{name}",
    connection="blob_connection_string",
)
def blob_status_updater(myblob: func.InputStream, jobId: str, fileName: str):
    logging.info(f"Blob trigger active: {myblob.name} (Size: {myblob.length} bytes)")

    try:
        container = get_cosmos_container()

        # Récupération de l'item avec l'ID extrait du chemin
        item = container.read_item(item=jobId, partition_key="JOB")

        # Mise à jour du statut vers "Uploaded"
        item["status"] = "Uploaded"

        # Mise à jour de la date de modification si disponible
        from datetime import datetime, timezone

        item["updatedAt"] = datetime.now(timezone.utc).isoformat()

        container.replace_item(item=jobId, body=item)

        logging.info(f"Statut mis à jour avec succès pour le job {jobId}")

    except Exception as e:
        logging.error(
            f"Erreur lors de la mise à jour Cosmos DB pour le job {jobId}: {str(e)}"
        )
