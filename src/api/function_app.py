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
    logging.info(
        f"Python blob trigger function processed blob \n"
        f"Name: {myblob.name}\n"
        f"JobId: {jobId}\n"
        f"FileName: {fileName}"
    )

    try:
        container = get_cosmos_container()

        # Récupérer l'élément actuel
        item = container.read_item(item=jobId, partition_key="JOB")

        # Mettre à jour le statut
        item["status"] = "Uploaded"
        item["updatedAt"] = item.get(
            "updatedAt", ""
        )  # On pourrait mettre à jour la date ici si besoin

        # Remplacer l'élément dans Cosmos DB
        container.replace_item(item=jobId, body=item)

        logging.info(f"Successfully updated status to 'Uploaded' for jobId: {jobId}")

    except Exception as e:
        logging.error(f"Error updating Cosmos DB for jobId {jobId}: {str(e)}")
