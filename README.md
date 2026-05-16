# Azure Cloud Document Manager 🚀

Ce projet est une application cloud-native permettant de gérer l'upload et le traitement asynchrone de documents sur Azure.

## 🏗️ Architecture du Pipeline

L'application utilise une architecture événementielle pour garantir la scalabilité et la robustesse :

1.  **Frontend (Next.js)** : Interface utilisateur pour uploader les fichiers et suivre l'état des traitements en temps réel.
2.  **API (FastAPI)** : Gère la création des jobs dans Cosmos DB et génère des URLs SAS sécurisées pour l'upload.
3.  **Blob Storage** : Stockage des fichiers originaux dans le conteneur `doc-storage`.
4.  **Azure Function 1 (Blob Trigger)** : Détecte l'arrivée d'un fichier et publie un message JSON dans Service Bus.
5.  **Azure Service Bus** : File d'attente (Queue) assurant le transport asynchrone des messages.
6.  **Azure Function 2 (Service Bus Trigger)** : Analyse le document (tagging automatique) et met à jour Cosmos DB.
7.  **Cosmos DB** : Base de données NoSQL stockant les métadonnées, les statuts et les tags.

---

## ✅ Ce qui a été fait

### Backend & API
- [x] Création des routes de gestion des jobs (Create, Get, List).
- [x] Configuration CORS pour permettre la communication avec le Frontend.
- [x] Support des redirections de slash sur Azure pour éviter les erreurs 405.
- [x] Intégration du SDK Cosmos DB pour le stockage permanent.

### Pipeline Asynchrone & Temps Réel
- [x] **Function 1** : Implémentation du Blob Trigger avec extraction intelligente du `jobId` et du `fileName`.
- [x] **Service Bus** : Configuration de l'envoi de messages JSON formatés.
- [x] **SignalR** : Intégration de Azure SignalR Service pour les notifications Push en temps réel.
- [x] **Negotiate** : Création de l'endpoint de négociation SignalR pour le Frontend.
- [x] **Function 2** : Système de tagging automatique basé sur les extensions et mots-clés.
- [x] **Validation** : Détection des fichiers vides (0 octet).

### Frontend (Quality of Life)
- [x] Dashboard moderne avec liste des jobs en temps réel.
- [x] **Temps Réel Actif** : Mise à jour automatique des badges et tags via WebSocket (SignalR) sans rafraîchir la page.
- [x] Badges de statut colorés (`CREATED`, `UPLOADED`, `PROCESSED`, `ERROR`).

### DevOps
- [x] Workflows GitHub Actions pour le déploiement automatique des fonctions et de l'API.
- [x] Gestion des artefacts et des credentials Azure (RBAC).
- [x] Configuration `host.json` et `requirements.txt`.

---

## 🛠️ Ce qu'il reste à faire

- [ ] **Sécurité** : Ajouter une couche d'authentification (Azure AD / MS Entra ID) sur l'API et le Frontend.
- [ ] **Monitoring** : Connecter Application Insights pour un suivi détaillé des performances et des erreurs des fonctions.
- [ ] **Intelligence Artificielle** : Utiliser Azure AI Services (OCR / Form Recognizer) dans la Function 2 pour un tagging plus profond basé sur le contenu du document.
- [ ] **Nettoyage** : Implémentation d'une fonction de purge automatique pour les fichiers temporaires ou les jobs très anciens.
- [ ] **UX** : Ajouter des notifications "Push" ou "Toast" lors du passage d'un job au statut `PROCESSED`.

---

## 🚀 Installation & Configuration

### Variables d'environnement requises
- `COSMOS_ENDPOINT` / `COSMOS_KEY`
- `BLOB_CONNECTION_STRING`
- `SERVICE_BUS_CONNECTION_STRING`
- `SERVICE_BUS_QUEUE_NAME`
- `NEXT_PUBLIC_API_URL` (Frontend)
