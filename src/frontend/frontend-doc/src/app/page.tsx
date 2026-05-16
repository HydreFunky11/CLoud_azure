"use client";

import { useState, useEffect } from "react";
import * as signalR from "@microsoft/signalr";

interface Job {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  tags?: string[];
  error?: string;
  size?: number;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL || API_URL;

  // 1. Charger les jobs au démarrage
  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_URL}/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch (err) {
      console.error("Erreur lors de la récupération des jobs", err);
    }
  };

  // 2. Connexion SignalR pour le Temps Réel
  useEffect(() => {
    fetchJobs();

    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${FUNCTIONS_URL}/api`)
      .withAutomaticReconnect()
      .build();

    connection.on("jobUpdated", (updatedJob: Job) => {
      console.log("SignalR Update:", updatedJob);
      setJobs((prevJobs) => {
        const index = prevJobs.findIndex((j) => j.id === updatedJob.id || j.id === updatedJob.documentId);
        const normalizedJob = { ...updatedJob, id: updatedJob.id || (updatedJob as any).documentId };
        
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
    setMessage("Création du job...");

    try {
      // 1. Créer le job
      const resCreate = await fetch(`${API_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });

      if (!resCreate.ok) throw new Error("Erreur création job");
      const { jobId, uploadUrl } = await resCreate.json();

      // 2. Upload vers Azure Blob Storage
      setMessage("Upload du fichier vers Azure...");
      const resUpload = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob" },
        body: file,
      });

      if (!resUpload.ok) throw new Error("Échec de l'upload vers Azure");

      setMessage("Analyse en cours (Temps réel)...");
      
      // Note: On n'appelle plus forcément /tags ici car la Function 2 (Service Bus) s'en occupe
      // Mais si on veut garder l'extraction OpenAI synchrone, on peut la laisser.
      // Pour le moment, on laisse SignalR faire la mise à jour automatique.

      setFile(null);
    } catch (err: any) {
      setMessage("Erreur : " + err.message);
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(""), 5000);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: any = {
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

  return (
    <main className="max-w-4xl mx-auto p-8 font-sans">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold text-slate-800">Gestionnaire de Documents Cloud</h1>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
          <span className="text-xs text-slate-500 font-medium">Temps Réel Actif</span>
        </div>
      </div>

      {/* Zone Upload */}
      <section className="bg-white p-6 rounded-lg shadow-md mb-8 border border-slate-200">
        <h2 className="text-xl font-semibold mb-4 text-slate-700">Nouveau Document</h2>
        <div className="flex flex-col gap-4">
          <input 
            type="file" 
            onChange={handleFileChange} 
            className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <button
            onClick={handleUpload}
            disabled={loading || !file}
            className={`w-full py-2 rounded-lg font-bold text-white transition-all ${
              loading || !file ? "bg-slate-300 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 shadow-lg"
            }`}
          >
            {loading ? "En cours..." : "Lancer l'analyse"}
          </button>
          {message && (
            <p className={`text-center text-sm font-medium ${message.includes("Erreur") ? "text-red-600" : "text-blue-600"}`}>
              {message}
            </p>
          )}
        </div>
      </section>

      {/* Liste des Jobs */}
      <section>
        <h2 className="text-xl font-semibold text-slate-700 mb-4">Flux de traitement</h2>
        
        <div className="grid gap-4">
          {jobs.length === 0 && <p className="text-slate-500 text-center py-8 italic">Aucun document traité pour le moment.</p>}
          
          {jobs.map((job) => (
            <div key={job.id} className="bg-white p-5 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-3 transition-all hover:border-blue-200">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-bold text-slate-800 text-lg">{job.fileName}</h3>
                  <p className="text-xs text-slate-400">ID: {job.id} • Créé le: {new Date(job.createdAt).toLocaleString()}</p>
                </div>
                {getStatusBadge(job.status)}
              </div>

              {job.error && <p className="text-sm text-red-500 bg-red-50 p-2 rounded border border-red-100">{job.error}</p>}

              {job.tags && job.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {job.tags.map((tag) => (
                    <span key={tag} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs border border-slate-200">
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
