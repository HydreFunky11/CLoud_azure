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
  taggingSource?: "openai" | "fallback";
  error?: string;
  size?: number;
}

function notifyJobProcessed(fileName: string, tags?: string[]) {
  const tagsSuffix = tags?.length ? ` — Tags : ${tags.join(", ")}` : "";
  toast.success(`« ${fileName} » est prêt${tagsSuffix}`);
}

async function readApiError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const detail: unknown = body.detail;
  if (typeof detail === "object" && detail !== null && "message" in detail) {
    return String((detail as { message: string }).message);
  }
  if (typeof detail === "string") return detail;
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
  const toastRefs = useRef<Record<string, string>>({});

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  const FUNCTIONS_URL = process.env.NEXT_PUBLIC_FUNCTIONS_URL || (typeof window !== "undefined" ? window.location.origin : "");

  useEffect(() => {
    console.log("FUNCTIONS_URL:", FUNCTIONS_URL);
    fetchJobs();

    // Fix pour le CORS Credentials Error : 
    // On définit explicitement les transports et on désactive les credentials si non authentifié
    const connection = new signalR.HubConnectionBuilder()
      .withUrl(`${FUNCTIONS_URL}/api`, {
        skipNegotiation: false,
        transport: signalR.HttpTransportType.WebSockets | signalR.HttpTransportType.LongPolling,
        withCredentials: false // INDISPENSABLE quand le CORS est sur '*'
      })
      .withAutomaticReconnect()
      .build();

    connection.on("jobUpdated", (updatedJob: any) => {
      const jobId = updatedJob.id || updatedJob.documentId;
      if (!jobId) return;
      const normalizedJob = { ...updatedJob, id: jobId };
      setJobs((prevJobs) => {
        const index = prevJobs.findIndex((j) => j.id === jobId);

        // Notification logic
        const prevStatus = prevStatusRef.current[jobId];
        const currentToastId = toastRefs.current[jobId];

        if (prevStatus !== "PROCESSED" && normalizedJob.status === "PROCESSED") {
          const tagsSuffix = normalizedJob.tags?.length ? ` — Tags : ${normalizedJob.tags.join(", ")}` : "";
          toast.success(`« ${normalizedJob.fileName} » est prêt${tagsSuffix}`, { id: currentToastId });
          delete toastRefs.current[jobId];
        } else if (prevStatus !== "ERROR" && normalizedJob.status === "ERROR") {
          toast.error(`« ${normalizedJob.fileName} » : ${normalizedJob.error || "Erreur"}`, { id: currentToastId });
          delete toastRefs.current[jobId];
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
  }, [FUNCTIONS_URL]);

  const fetchJobs = async () => {
    try {
      const res = await fetch(`${API_URL}/jobs`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
        data.forEach((j: Job) => prevStatusRef.current[j.id] = j.status);
      }
    } catch (err) { console.error("Fetch jobs error", err); }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    setMessageType("info");
    setMessage("Création du job...");

    try {
      const resCreate = await fetch(`${API_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });
      if (!resCreate.ok) throw new Error(await readApiError(resCreate));
      const { jobId, uploadUrl } = await resCreate.json();

      // AJOUT IMMÉDIAT DANS LA LISTE
      const newJob: Job = {
        id: jobId,
        fileName: file.name,
        status: "CREATED",
        createdAt: new Date().toISOString()
      };
      setJobs(prev => [newJob, ...prev]);
      prevStatusRef.current[jobId] = "CREATED";
      
      // Lancement du Toaster de chargement
      toastRefs.current[jobId] = toast.loading(`Analyse de ${file.name}...`);

      setMessage("Upload du fichier...");
      const resUpload = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "x-ms-blob-type": "BlockBlob" },
        body: file,
      });
      if (!resUpload.ok) throw new Error("Échec de l'upload vers Azure");

      setMessage("Analyse OpenAI en cours...");
      const resTags = await fetch(`${API_URL}/jobs/${jobId}/tags`, { method: "POST" });

      if (!resTags.ok) {
        const errMsg = await readApiError(resTags);
        toast.error(`OpenAI : ${errMsg}`, { id: toastRefs.current[jobId], duration: 8000 });
        setMessage(`Job créé et fichier sur Azure. Analyse OpenAI impossible : ${errMsg}`);
        setMessageType("warning");
        prevStatusRef.current[jobId] = "UPLOADED";
        fetchJobs();
        setFile(null);
        return;
      }

      const processedJob = await resTags.json();
      prevStatusRef.current[jobId] = "PROCESSED";
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, ...processedJob, id: jobId } : j))
      );
      notifyJobProcessed(file.name, processedJob.tags);
      toast.dismiss(toastRefs.current[jobId]);
      delete toastRefs.current[jobId];

      setMessage("Succès ! Document analysé avec OpenAI.");
      setMessageType("success");
      setFile(null);
      fetchJobs();
    } catch (err: any) {
      setMessage("Erreur : " + err.message);
      setMessageType("error");
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(""), 10000);
    }
  };

  const getBadgeStyle = (status: string) => {
    const base = { padding: "4px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: "bold" };
    if (status === "PROCESSED") return { ...base, backgroundColor: "#dcfce7", color: "#166534" };
    if (status === "ERROR") return { ...base, backgroundColor: "#fee2e2", color: "#991b1b" };
    if (status === "UPLOADED") return { ...base, backgroundColor: "#fef9c3", color: "#854d0e" };
    return { ...base, backgroundColor: "#dbeafe", color: "#1e40af" };
  };

  return (
    <div style={{ backgroundColor: "#f8fafc", minHeight: "100 screen", padding: "40px 20px", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        
        {/* Header */}
        <header style={{ backgroundColor: "white", padding: "24px", borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", marginBottom: "32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: "24px", color: "#0f172a" }}>DocManager Cloud</h1>
            <p style={{ margin: "4px 0 0", fontSize: "14px", color: "#64748b" }}>Analyse en temps réel</p>
          </div>
          <div style={{ backgroundColor: "#f1f5f9", padding: "8px 16px", borderRadius: "20px", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ width: "8px", height: "8px", backgroundColor: "#22c55e", borderRadius: "50%" }}></span>
            <span style={{ fontSize: "12px", fontWeight: "bold", color: "#334155" }}>LIVE SYNC</span>
          </div>
        </header>

        {/* Upload Box */}
        <section style={{ backgroundColor: "white", padding: "32px", borderRadius: "16px", boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)", marginBottom: "32px" }}>
          <h2 style={{ fontSize: "18px", marginBottom: "20px", color: "#1e293b" }}>Nouveau Document</h2>
          <div style={{ border: "2px dashed #e2e8f0", padding: "40px", borderRadius: "12px", textAlign: "center", marginBottom: "20px", backgroundColor: "#f8fafc" }}>
            <input type="file" id="f" onChange={(e) => e.target.files && setFile(e.target.files[0])} style={{ display: "none" }} />
            <label htmlFor="f" style={{ cursor: "pointer", color: "#475569" }}>
              <strong>{file ? file.name : "Cliquez pour choisir un fichier"}</strong>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "8px" }}>PDF, PNG, DOCX (Max 10Mo)</div>
            </label>
          </div>
          <button 
            onClick={handleUpload} 
            disabled={loading || !file}
            style={{ width: "100%", padding: "16px", borderRadius: "12px", border: "none", backgroundColor: loading || !file ? "#cbd5e1" : "#2563eb", color: "white", fontWeight: "bold", fontSize: "16px", cursor: loading || !file ? "not-allowed" : "pointer", transition: "0.2s" }}
          >
            {loading ? "Chargement..." : "Lancer l'analyse"}
          </button>
          {message && <div style={{ marginTop: "16px", textAlign: "center", fontSize: "14px", fontWeight: "bold", color: messageType === "error" ? "#dc2626" : "#2563eb" }}>{message}</div>}
        </section>

        {/* List */}
        <section>
          <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "20px", color: "#1e293b" }}>Flux de traitement</h2>
          <div style={{ display: "grid", gap: "16px" }}>
            {jobs.length === 0 && <p style={{ textAlign: "center", color: "#94a3b8", padding: "40px" }}>Aucun document.</p>}
            {jobs.map(job => (
              <div key={job.id} style={{ backgroundColor: "white", padding: "20px", borderRadius: "16px", border: "1px solid #f1f5f9", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: "bold", color: "#0f172a", fontSize: "16px" }}>{job.fileName}</div>
                    <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "4px" }}>ID: {job.id.substring(0,8)}... • {new Date(job.createdAt).toLocaleTimeString()}</div>
                  </div>
                  <span style={getBadgeStyle(job.status)}>{job.status}</span>
                </div>
                {job.error && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      backgroundColor: job.taggingSource === "fallback" ? "#fffbeb" : "#fff1f2",
                      color: job.taggingSource === "fallback" ? "#b45309" : "#b91c1c",
                      borderRadius: "8px",
                      fontSize: "13px",
                    }}
                  >
                    {job.error}
                  </div>
                )}
                {job.taggingSource && (
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "8px" }}>
                    Tags via {job.taggingSource === "openai" ? "OpenAI" : "règles (fallback)"}
                  </div>
                )}
                {job.tags && job.tags.length > 0 && (
                  <div style={{ marginTop: "16px", display: "flex", flexWrap: "wrap", gap: "8px", borderTop: "1px solid #f8fafc", paddingTop: "12px" }}>
                    {job.tags.map(t => <span key={t} style={{ backgroundColor: "#f1f5f9", color: "#475569", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "bold" }}>#{t}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
