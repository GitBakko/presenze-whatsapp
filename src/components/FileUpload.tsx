"use client";

import { useCallback, useState } from "react";
import { Upload } from "lucide-react";

interface FileUploadProps {
  onUpload: (file: File) => Promise<void>;
  isLoading: boolean;
}

export function FileUpload({ onUpload, isLoading }: FileUploadProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".txt")) {
        setSelectedFile(file);
      }
    },
    []
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (selectedFile) {
      await onUpload(selectedFile);
      setSelectedFile(null);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-primary bg-primary-fixed/10"
            : "border-outline-variant bg-surface-container-low hover:border-outline"
        }`}
      >
        <Upload className="mb-2 h-10 w-10 text-primary" strokeWidth={1.5} />
        <p className="text-sm font-medium text-on-surface">
          Trascina qui il file .txt esportato da WhatsApp
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">oppure</p>
        <label className="mt-2 cursor-pointer rounded-lg bg-surface-container-lowest px-4 py-2 text-sm font-medium text-primary shadow-card transition-shadow hover:shadow-elevated focus-within:ring-2 focus-within:ring-primary/30">
          Sfoglia file
          <input
            type="file"
            accept=".txt"
            aria-label="Seleziona file da importare"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>
      </div>
      {selectedFile && (
        <div className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-4 py-3 shadow-card">
          <div>
            <p className="text-sm font-medium text-on-surface">
              {selectedFile.name}
            </p>
            <p className="text-xs text-on-surface-variant">
              {(selectedFile.size / 1024).toFixed(1)} KB
            </p>
          </div>
          <button
            onClick={handleUpload}
            disabled={isLoading}
            className="rounded-lg bg-gradient-to-br from-primary to-primary-container px-4 py-2 text-sm font-medium text-on-primary transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed disabled:cursor-not-allowed"
          >
            {isLoading ? "Importando..." : "Importa"}
          </button>
        </div>
      )}
    </div>
  );
}
