import logging
import json
import os
from datetime import datetime, timezone
import azure.functions as func
from azure.servicebus import ServiceBusClient, ServiceBusMessage
from app.cosmos import get_cosmos_container

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)

# Route de test pour vérifier si les fonctions HTTP marchent
@app.route(route="ping", methods=["GET"])
def ping(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("pong", status_code=200)

# --- SIGNALR NEGOTIATION ---
@app.route(route="negotiate", methods=["POST"])
@app.generic_input_binding(arg_name="connectionInfo", 
                           type="signalRConnectionInfo", 
                           hubName="serverless", 
                           connectionStringSetting="AzureSignalRConnectionString")
def negotiate(req: func.HttpRequest, connectionInfo) -> func.HttpResponse:
    logging.info("Negotiate request received")
    return func.HttpResponse(connectionInfo, status_code=200, mimetype="application/json")


# --- FUNCTION 1: BLOB TRIGGER ---
@app.blob_trigger(arg_name="myblob", 
                  path="doc-storage/input/{name}", 
                  connection="BLOB_CONNECTION_STRING") 
@app.generic_output_binding(arg_name="signalRMessages", 
                            type="signalR", 
                            hubName="serverless", 
                            connectionStringSetting="AzureSignalRConnectionString")
def blob_to_servicebus_trigger(myblob: func.InputStream, signalRMessages: func.Out[str]):
    logging.info(f"!!! TRIGGER BLOB ACTIVÉ !!! Fichier : {myblob.name}")
    
    try:
        conn_str = os.getenv("SERVICE_BUS_CONNECTION_STRING")
        queue_name = os.getenv("SERVICE_BUS_QUEUE_NAME")
        
        blob_path = myblob.name 
        parts = blob_path.split("/")
        
        job_id = parts[2] if len(parts) > 2 else "UNKNOWN"
        file_name = parts[3] if len(parts) > 3 else parts[-1]

        message_data = {
            "documentId": job_id,
            "fileName": file_name,
            "blobName": blob_path,
            "size": myblob.length,
            "uploadedAt": datetime.now(timezone.utc).isoformat(),
            "status": "UPLOADED"
        }
        
        # 1. Notification Temps Réel via SignalR
        signalRMessages.set(json.dumps({
            "target": "jobUpdated",
            "arguments": [message_data]
        }))

        # 2. Envoi vers Service Bus pour la suite du traitement
        if conn_str and queue_name:
            with ServiceBusClient.from_connection_string(conn_str) as client:
                with client.get_queue_sender(queue_name=queue_name) as sender:
                    message = ServiceBusMessage(json.dumps(message_data))
                    sender.send_messages(message)
                    logging.info(f"SUCCESS: Message envoyé au Bus pour {job_id}")
        else:
            logging.error("Variables Service Bus manquantes")

    except Exception as e:
        logging.error(f"EXCEPTION dans le Trigger Blob : {str(e)}")


# --- FUNCTION 2: SERVICE BUS TRIGGER ---
@app.service_bus_queue_trigger(arg_name="msg", 
                               queue_name=os.getenv("SERVICE_BUS_QUEUE_NAME", "document-processing"), 
                               connection="SERVICE_BUS_CONNECTION_STRING")
@app.generic_output_binding(arg_name="signalRMessages", 
                            type="signalR", 
                            hubName="serverless", 
                            connectionStringSetting="AzureSignalRConnectionString")
def servicebus_processor(msg: func.ServiceBusMessage, signalRMessages: func.Out[str]):
    logging.info("!!! TRIGGER SERVICE BUS ACTIVÉ !!!")
    try:
        body = msg.get_body().decode('utf-8')
        data = json.loads(body)
        document_id = data.get("documentId")
        file_name = data.get("fileName", "").lower()
        size = data.get("size", 0)
        
        container = get_cosmos_container()
        
        try:
            item = container.read_item(item=document_id, partition_key="JOB")
        except Exception:
            logging.error(f"Document {document_id} introuvable")
            return

        if size == 0:
            item["status"] = "ERROR"
            item["error"] = "File is empty"
        else:
            tags = set()
            if file_name.endswith(".pdf"): tags.update(["pdf", "document"])
            elif file_name.endswith(".docx"): tags.update(["word", "document"])
            elif file_name.endswith(".png"): tags.add("image")
                
            keywords_map = {
                "cv": ["cv", "rh"], "facture": ["facture", "comptabilite"],
                "contrat": ["contrat", "administratif"], "azure": ["azure", "cloud"],
                "docker": ["docker", "devops"]
            }
            for key, val in keywords_map.items():
                if key in file_name: tags.update(val)
            
            item["status"] = "PROCESSED"
            item["tags"] = list(tags)
            item["processedAt"] = datetime.now(timezone.utc).isoformat()

        # 1. Sauvegarde Cosmos DB
        container.replace_item(item=document_id, body=item)
        
        # 2. Notification Temps Réel via SignalR
        signalRMessages.set(json.dumps({
            "target": "jobUpdated",
            "arguments": [item]
        }))
        
        logging.info(f"SUCCESS: Job {document_id} mis à jour et notifié")

    except Exception as e:
        logging.error(f"EXCEPTION dans le processeur SB : {str(e)}")
