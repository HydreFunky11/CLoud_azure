"use client";

import { useState, useEffect, useRef } from "react";
import * as signalR from "@microsoft/signalr";
import toast from "react-hot-toast";

interface Job {
  id: string;
  documentId?: string;
  fileName: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  tags?: string[];
  error?: string;
  size?: number;
}

function notifyJobProcessed(fileName: string, tags?: string[]) {
  const tagsSuffix = tags?.length ? ` — Tags : ${tags.join(", ")}` : "";
  toast.success(`« ${fileName} » est prêt${tagsSuffix}`);
}

interface ApiErrorDetail {
  step?: string;
  message?: string;
  jobId?: string;
  fileName?: string;
  jobCreated?: boolean;
  fileUploaded?: boolean;
}

async function readApiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const detail: unknown = body.detail;

  if (typeof detail === "object" && detail !== null && "message" in detail) {
    return String((detail as ApiErrorDetail).message);
  }
  if (typeof detail === "string") {
    if (detail.startsWith("OpenAI error:") && detail.includes("insufficient_quota")) {
      return "Quota OpenAI dépassé. Vérifiez votre facturation sur platform.openai.com.";
    }
    return detail;
  }
  return `Erreur serveur (${res.status})`;
}

type MessageType = "info" | "success" | "warning" | "error";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<MessageType>("info");
  const prevStatusRef = useRef<Record<string, string>>({});

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL || (typeof window !== "undefined" ? window.location.origin : "");

  // DEBUG: On log l'URL pour vérifier si elle est bien injectée au build
  useEffect(() => {
    console.log("Frontend initialized");
    console.log("API_URL:", API_URL);
    console.log("FUNCTIONS_URL:", FUNCTIONS_URL);
  }, [API_URL, FUNCTIONS_URL]);

  const showMessage = (text: string, type: MessageType) => {
    setMessage(text);
    setMessageType(type);
  };

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_URL}/jobs`);
      if (!res.ok) return;
      const data: Job[] = await res.json();
      
      // Update local storage of statuses for toast detection
      for (const job of data) {
        prevStatusRef.current[job.id] = job.status;
      }
      setJobs(data);
    } catch (err) {
      console.error("Erreur lors de la récupération des jobs", err);
    }
  };

  useEffect(() => {
    fetchJobs();

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${FUNCTIONS_URL}/api`)
      .withAutomaticReconnect()
      .build();

    connection.on("jobUpdated", (updatedJob: Job) => {
      const jobId = updatedJob.id || updatedJob.documentId;
      if (!jobId) return;

      const normalizedJob = { ...updatedJob, id: jobId };
      
      setJobs((prevJobs) => {
        const index = prevJobs.findIndex((j) => j.id === jobId);
        
        // Notification logic
        const prevStatus = prevStatusRef.current[jobId];
        if (prevStatus !== "PROCESSED" && normalizedJob.status === "PROCESSED") {
          notifyJobProcessed(normalizedJob.fileName, normalizedJob.tags);
        } else if (prevStatus !== "ERROR" && normalizedJob.status === "ERROR") {
          toast.error(`« ${normalizedJob.fileName} » : ${normalizedJob.error || "Erreur de traitement"}`);
        }
        prevStatusRef.current[jobId] = normalizedJob.status;

        if (index !== -1) {
          const newJobs = [...prevJobs];
          newJobs[index] = { ...newJobs[index], ...normalizedJob };
          return newJobs;
        } else {
          return [normalizedJob, ...prevJobs];
        }
      });
    });

    connection.start().catch(err => console.error("SignalR Connection Error: ", err));

    return () => {
      connection.stop();
    };
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    showMessage("Étape 1/2 — Création du job...", "info");

    const fileName = file.name;

    try {
      // 1. Créer le job
      const resCreate = await fetch(`${API_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, contentType: file.type }),
      });

      if (!resCreate.ok) {
        const errMsg = await readApiError(resCreate);
        toast.error(`Étape 1/2 — Job : ${errMsg}`);
        showMessage(`Échec à la création du job : ${errMsg}`, "error");
        return;
      }

      const created = await resCreate.json();
      const { jobId, uploadUrl } = created;
      prevStatusRef.current[jobId] = "CREATED";

      // 2. Upload vers Azure Blob Storage
      showMessage("Étape 2/2 — Envoi du fichier vers Azure...", "info");
      const resUpload = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob" },
        body: file,
      });

      if (!resUpload.ok) {
        toast.error("Étape 2/2 — Upload Azure échoué");
        showMessage(
          `Le job existe (id: ${jobId}), mais le fichier n'a pas pu être envoyé sur Azure.`,
          "warning"
        );
        fetchJobs();
        return;
      }

      showMessage("Succès ! Upload terminé. Analyse en cours (Temps réel)...", "success");
      setFile(null);
      // La mise à jour du statut viendra par SignalR (UPLOADED puis PROCESSED)
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Erreur inattendue";
      toast.error(errMsg);
      showMessage(errMsg, "error");
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(""), 10000);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      CREATED: "bg-blue-100 text-blue-800",
      UPLOADED: "bg-yellow-100 text-yellow-800",
      PROCESSED: "bg-green-100 text-green-800",
      ERROR: "bg-red-100 text-red-800",
    };
    return (
      <span className={`px-2 py-1 rounded text-xs font-bold ${colors[status] || "bg-gray-100"}`}>
        {status}
      </span>
    );
  };

  const messageColorClass = {
    info: "text-blue-600",
    success: "text-green-600",
    warning: "text-amber-600",
    error: "text-red-600",
  }[messageType];

  return (
    <main className="max-w-4xl mx-auto p-8 font-sans bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center mb-10 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">DocManager Cloud</h1>
          <p className="text-slate-500 text-sm mt-1">Analyse de documents en temps réel</p>
        </div>
        <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-full border border-slate-200">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
          </span>
          <span className="text-xs text-slate-700 font-bold uppercase tracking-wider">Live Sync</span>
        </div>
      </div>

      {/* Zone Upload */}
      <section className="bg-white p-8 rounded-2xl shadow-lg mb-10 border border-slate-100 transition-all hover:shadow-xl">
        <h2 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Nouveau Document
        </h2>
        <div className="flex flex-col gap-6">
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center bg-slate-50 transition-colors hover:border-blue-300 group">
            <input 
              type="file" 
              onChange={handleFileChange} 
              id="file-upload"
              className="hidden"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <span className="text-slate-600 block mb-2 font-medium group-hover:text-blue-600 transition-colors">
                {file ? file.name : "Cliquez pour choisir un fichier ou glissez-déposez"}
              </span>
              <span className="text-xs text-slate-400 italic">PDF, PNG, DOCX (Max 10Mo)</span>
            </label>
          </div>
          
          <button
            onClick={handleUpload}
            disabled={loading || !file}
            className={`w-full py-4 rounded-xl font-extrabold text-white transition-all transform active:scale-95 ${
              loading || !file ? "bg-slate-300 cursor-not-allowed" : "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg"
            }`}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Analyse en cours...
              </span>
            ) : "Lancer l'analyse intelligente"}
          </button>
          
          {message && (
            <div className={`p-4 rounded-xl text-center text-sm font-bold border ${
              messageType === 'error' ? "bg-red-50 text-red-700 border-red-100" : 
              messageType === 'success' ? "bg-green-50 text-green-700 border-green-100" : 
              "bg-blue-50 text-blue-700 border-blue-100"
            }`}>
              {message}
            </div>
          )}
        </div>
      </section>

      {/* Liste des Jobs */}
      <section>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Flux de traitement</h2>
          <div className="flex gap-2">
            <div className="h-2 w-2 rounded-full bg-slate-200"></div>
            <div className="h-2 w-2 rounded-full bg-slate-200"></div>
          </div>
        </div>
        
        <div className="grid gap-6">
          {jobs.length === 0 && (
            <div className="bg-white p-12 rounded-2xl border-2 border-dashed border-slate-200 text-center">
              <p className="text-slate-400 italic">Aucun document dans la file de traitement.</p>
            </div>
          )}
          
          {jobs.map((job) => (
            <div key={job.id} className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex flex-col gap-4 transition-all hover:shadow-md hover:border-blue-100 group">
              <div className="flex justify-between items-start">
                <div className="flex gap-4 items-center">
                  <div className={`p-3 rounded-xl ${
                    job.status === 'PROCESSED' ? 'bg-green-50 text-green-600' :
                    job.status === 'ERROR' ? 'bg-red-50 text-red-600' :
                    'bg-blue-50 text-blue-600'
                  }`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 text-lg group-hover:text-blue-600 transition-colors">{job.fileName}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-xs text-slate-400 font-medium">ID: {job.id.substring(0,8)}...</p>
                      <span className="text-slate-300">•</span>
                      <p className="text-xs text-slate-400">{new Date(job.createdAt).toLocaleTimeString()} ({new Date(job.createdAt).toLocaleDateString()})</p>
                    </div>
                  </div>
                </div>
                {getStatusBadge(job.status)}
              </div>

              {job.error && (
                <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center gap-3 text-red-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm font-semibold">{job.error}</p>
                </div>
              )}

              {job.tags && job.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-50">
                  {job.tags.map((tag) => (
                    <span key={tag} className="bg-slate-50 text-slate-500 px-3 py-1 rounded-lg text-xs font-bold border border-slate-100 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-100 transition-all cursor-default">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
