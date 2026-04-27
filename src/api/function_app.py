import logging
import json
import os
from datetime import datetime, timezone
import azure.functions as func
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from app.cosmos import get_cosmos_container

app = func.FunctionApp()

# Configuration
SERVICE_BUS_CONN_STR = os.getenv("SERVICE_BUS_CONNECTION_STRING")
QUEUE_NAME = os.getenv("SERVICE_BUS_QUEUE_NAME")

# --- FUNCTION 1: BLOB TRIGGER ---
@app.blob_trigger(arg_name="myblob", 
                  path="input/{name}", 
                  connection="blob_connection_string") 
def blob_to_servicebus_trigger(myblob: func.InputStream):
    blob_full_name = myblob.name 
    relative_path = blob_full_name.split("/", 1)[-1] if "/" in blob_full_name else blob_full_name
    
    logging.info(f"Fichier détecté : {blob_full_name} ({myblob.length} bytes)")

    try:
        if "_" in relative_path:
            document_id, file_name = relative_path.split("_", 1)
        else:
            document_id = "UNKNOWN"
            file_name = relative_path

        message_data = {
            "documentId": document_id,
            "fileName": file_name,
            "blobName": blob_full_name,
            "size": myblob.length,
            "uploadedAt": datetime.now(timezone.utc).isoformat()
        }
        
        if SERVICE_BUS_CONN_STR and QUEUE_NAME:
            with ServiceBusClient.from_connection_string(SERVICE_BUS_CONN_STR) as client:
                with client.get_queue_sender(queue_name=QUEUE_NAME) as sender:
                    message = ServiceBusMessage(json.dumps(message_data))
                    sender.send_messages(message)
                    logging.info(f"Message envoyé vers Service Bus pour le document {document_id}")
        else:
            logging.error("Configuration Service Bus manquante")

    except Exception as e:
        logging.error(f"Erreur lors du traitement du blob {blob_full_name} : {str(e)}")


# --- FUNCTION 2: SERVICE BUS TRIGGER ---
@app.service_bus_queue_trigger(arg_name="msg", 
                               queue_name=os.getenv("SERVICE_BUS_QUEUE_NAME", "document-processing"), 
                               connection="SERVICE_BUS_CONNECTION_STRING")
def servicebus_processor(msg: func.ServiceBusMessage):
    # 1. Lire le message
    try:
        body = msg.get_body().decode('utf-8')
        data = json.loads(body)
        document_id = data.get("documentId")
        file_name = data.get("fileName", "").lower()
        size = data.get("size", 0)
        
        logging.info(f"Traitement du message Service Bus pour le document : {document_id}")
        
        container = get_cosmos_container()
        
        # 2. Vérifier si le document existe dans Cosmos DB
        try:
            item = container.read_item(item=document_id, partition_key="JOB")
        except Exception:
            logging.error(f"Document {document_id} introuvable dans Cosmos DB")
            return # On s'arrête ici si le doc n'existe pas

        # 3. Règles de validation
        if size == 0:
            logging.warning(f"Fichier vide détecté pour {document_id}")
            item["status"] = "ERROR"
            item["error"] = "File is empty"
        else:
            # 4. Moteur de Tagging
            tags = set()
            
            # Extensions
            if file_name.endswith(".pdf"):
                tags.update(["pdf", "document"])
            elif file_name.endswith(".docx"):
                tags.update(["word", "document"])
            elif file_name.endswith(".png"):
                tags.add("image")
                
            # Mots-clés
            keywords_map = {
                "cv": ["cv", "rh"],
                "facture": ["facture", "comptabilite"],
                "contrat": ["contrat", "administratif"],
                "azure": ["azure", "cloud"],
                "docker": ["docker", "devops"]
            }
            
            for key, val in keywords_map.items():
                if key in file_name:
                    tags.update(val)
            
            # 5. Mise à jour Succès
            item["status"] = "PROCESSED"
            item["tags"] = list(tags)
            item["processedAt"] = datetime.now(timezone.utc).isoformat()
            logging.info(f"Document {document_id} traité avec succès. Tags : {item['tags']}")

        # 6. Sauvegarde finale dans Cosmos DB
        container.replace_item(item=document_id, body=item)

    except Exception as e:
        logging.error(f"Erreur lors du traitement Service Bus : {str(e)}")
