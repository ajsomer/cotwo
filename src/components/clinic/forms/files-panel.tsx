"use client";

import { useState, useRef, useEffect } from "react";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { FileRow } from "@/stores/clinic-store";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Upload Modal
// ---------------------------------------------------------------------------

function UploadModal({
  orgId,
  onClose,
  onUploaded,
}: {
  orgId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(f: File) {
    if (f.type !== "application/pdf") {
      setError("Only PDF files are accepted.");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB.");
      return;
    }
    setError(null);
    setFile(f);
    // Pre-fill name from filename (minus .pdf extension)
    if (!name) {
      const baseName = f.name.replace(/\.pdf$/i, "");
      setName(baseName);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) handleFileSelect(selected);
  }

  async function handleUpload() {
    if (!file || !name.trim()) return;
    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("org_id", orgId);
    formData.append("name", name.trim());
    if (description.trim()) formData.append("description", description.trim());

    try {
      const res = await fetch("/api/files", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Upload failed");
        setUploading(false);
        return;
      }

      onUploaded();
      onClose();
    } catch {
      setError("Upload failed. Please try again.");
      setUploading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-lg w-full max-w-md mx-4 p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">
          Upload file
        </h2>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={`mb-4 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
            dragOver
              ? "border-teal-500 bg-teal-50"
              : file
              ? "border-teal-400 bg-teal-50/50"
              : "border-gray-200 hover:border-gray-300"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleInputChange}
            className="hidden"
          />
          {file ? (
            <div className="text-center">
              <svg
                className="h-8 w-8 text-teal-500 mx-auto mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <p className="text-sm font-medium text-gray-800">{file.name}</p>
              <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
            </div>
          ) : (
            <div className="text-center">
              <svg
                className="h-8 w-8 text-gray-300 mx-auto mb-2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
                />
              </svg>
              <p className="text-sm text-gray-500">
                Drop a PDF here or click to browse
              </p>
              <p className="text-xs text-gray-400 mt-1">PDF only, max 10 MB</p>
            </div>
          )}
        </div>

        {/* Name */}
        <div className="mb-3">
          <label className="text-xs font-medium text-gray-500 block mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ADHD Fact Sheet"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="text-xs font-medium text-gray-500 block mb-1">
            Description (optional)
          </label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="One-line description"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-500 mb-3">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
          <Button
            onClick={handleUpload}
            disabled={!file || !name.trim() || uploading}
            size="sm"
          >
            {uploading ? "Uploading..." : "Upload"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files Panel
// ---------------------------------------------------------------------------

export function FilesPanel() {
  const { org } = useOrg();
  const files = useClinicStore((s) => s.files);
  const loading = !useClinicStore((s) => s.filesLoaded);
  const [showUpload, setShowUpload] = useState(false);

  const refetchFiles = () => {
    if (org) getClinicStore().refreshFiles(org.id);
  };

  // Load files on mount if not loaded
  useEffect(() => {
    if (org && !useClinicStore.getState().filesLoaded) {
      getClinicStore().refreshFiles(org.id);
    }
  }, [org]);

  const handleView = async (file: FileRow) => {
    try {
      const res = await fetch(`/api/files/preview?storage_path=${encodeURIComponent(file.storage_path)}`);
      if (!res.ok) {
        alert("Failed to generate preview link");
        return;
      }
      const data = await res.json();
      window.open(data.signed_url, "_blank");
    } catch {
      alert("Failed to generate preview link");
    }
  };

  const handleArchive = async (file: FileRow) => {
    if (!confirm(`Archive "${file.name}"? Existing patient links will still work.`))
      return;

    const res = await fetch(`/api/files?id=${file.id}`, { method: "DELETE" });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Failed to archive file");
      return;
    }

    refetchFiles();
  };

  if (!org) {
    return (
      <div className="text-sm text-gray-500">No organisation found.</div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-800">File library</p>
        <Button onClick={() => setShowUpload(true)} size="sm">
          + Upload file
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl border border-gray-200 bg-white"
            />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No files uploaded yet. Upload your first PDF to share with patients
            via workflows.
          </p>
          <div className="mt-3">
            <Button onClick={() => setShowUpload(true)} size="sm">
              + Upload file
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50/50">
                <th className="px-4 py-3 text-left font-medium text-gray-500">
                  Name
                </th>
                <th className="w-24 px-4 py-3 text-left font-medium text-gray-500">
                  Size
                </th>
                <th className="w-32 px-4 py-3 text-left font-medium text-gray-500">
                  Uploaded
                </th>
                <th className="w-28 px-4 py-3 text-right font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr
                  key={file.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">
                      {file.name}
                    </span>
                    {file.description && (
                      <span className="block text-xs text-gray-400 mt-0.5">
                        {file.description}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatFileSize(file.file_size_bytes)}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {formatDate(file.created_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => handleView(file)}
                        className="rounded px-2 py-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        title="View PDF"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleArchive(file)}
                        className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                        title="Archive file"
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.5}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <UploadModal
          orgId={org.id}
          onClose={() => setShowUpload(false)}
          onUploaded={refetchFiles}
        />
      )}
    </div>
  );
}
