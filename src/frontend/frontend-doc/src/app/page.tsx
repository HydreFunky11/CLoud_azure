"use client";

import { useState, ChangeEvent } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

interface JobResponse {
  jobId: string;
  status: string;
  uploadUrl: string;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return alert("Sélectionne un fichier");

    setStatus("Étape 1 : Création du job...");
    try {
      // 1. Demande de la SAS URL au Backend
      const res = await fetch(`${API_URL}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name }),
      });

      if (!res.ok) throw new Error("Erreur API Backend");

      const { uploadUrl, jobId }: JobResponse = await res.json();

      setStatus(`Étape 2 : Upload du fichier ${jobId} vers Azure...`);

      // 2. Upload direct vers Azure Blob Storage (Méthode PUT)
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "x-ms-blob-type": "BlockBlob",
          "Content-Type": file.type,
        },
        body: file,
      });

      if (uploadRes.ok) {
        setStatus(`Terminé ! Job créé : ${jobId}`);
      } else {
        setStatus("Échec de l'upload vers Azure");
      }
    } catch (err: any) {
      setStatus("Erreur: " + err.message);
    }
  };

  return (
    <main style={{ padding: "20px" }}>
      <h1>Next.js Storage Upload</h1>
      <input type="file" onChange={onFileChange} />
      <button onClick={handleUpload}>Démarrer l'upload</button>
      <p>Statut : {status}</p>
    </main>
  );
}
