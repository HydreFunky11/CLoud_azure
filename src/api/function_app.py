import logging
import json
import os
from datetime import datetime, timezone
import azure.functions as func
from azure.servicebus import ServiceBusClient, ServiceBusMessage

app = func.FunctionApp()

# Récupération des configurations Service Bus depuis les variables d'environnement
SERVICE_BUS_CONN_STR = os.getenv("SERVICE_BUS_CONNECTION_STRING")
QUEUE_NAME = os.getenv("SERVICE_BUS_QUEUE_NAME")

@app.blob_trigger(arg_name="myblob", 
                  path="input/{name}", 
                  connection="blob_connection_string") 
def blob_to_servicebus_trigger(myblob: func.InputStream):
    # Le nom complet du blob (ex: input/123_cv.pdf)
    blob_full_name = myblob.name 
    # Extraire juste le nom du fichier sans le préfixe du conteneur
    # myblob.name contient souvent "container/path/file.ext"
    relative_path = blob_full_name.split("/", 1)[-1] if "/" in blob_full_name else blob_full_name
    
    logging.info(f"Fichier détecté : {blob_full_name} ({myblob.length} bytes)")

    try:
        # Extraction du documentId et fileName à partir de "123_cv.pdf"
        if "_" in relative_path:
            document_id, file_name = relative_path.split("_", 1)
        else:
            document_id = "UNKNOWN"
            file_name = relative_path

        # Préparation du message JSON
        message_data = {
            "documentId": document_id,
            "fileName": file_name,
            "blobName": blob_full_name,
            "size": myblob.length,
            "uploadedAt": datetime.now(timezone.utc).isoformat()
        }
        
        # Envoi vers Service Bus
        if SERVICE_BUS_CONN_STR and QUEUE_NAME:
            with ServiceBusClient.from_connection_string(SERVICE_BUS_CONN_STR) as client:
                with client.get_queue_sender(queue_name=QUEUE_NAME) as sender:
                    message = ServiceBusMessage(json.dumps(message_data))
                    sender.send_messages(message)
                    logging.info(f"Message envoyé vers Service Bus pour le document {document_id}")
        else:
            logging.error("Configuration Service Bus manquante (SERVICE_BUS_CONNECTION_STRING ou SERVICE_BUS_QUEUE_NAME)")

    except Exception as e:
        logging.error(f"Erreur lors du traitement du blob {blob_full_name} : {str(e)}")
