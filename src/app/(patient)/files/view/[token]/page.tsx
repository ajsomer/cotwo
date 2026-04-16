"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";

interface FileData {
  name: string;
  size_bytes: number;
  mime_type: string;
  signed_url: string;
}

interface OrgData {
  name: string;
  logo_url: string | null;
}

export default function FileViewerPage() {
  const params = useParams();
  const token = params.token as string;

  const [file, setFile] = useState<FileData | null>(null);
  const [org, setOrg] = useState<OrgData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/files/view/${token}`);
        if (!res.ok) {
          const data = await res.json();
          setError(data.error ?? "This link is no longer available");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setFile(data.file);
        setOrg(data.org);
      } catch {
        setError("Something went wrong. Please try again later.");
      }
      setLoading(false);
    }
    load();
  }, [token]);

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Loading
  if (loading) {
    return (
      <div className="mx-auto max-w-[420px] px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200" />
          <div className="h-[60vh] rounded-lg bg-gray-200" />
        </div>
      </div>
    );
  }

  // Error
  if (error || !file) {
    return (
      <div className="mx-auto max-w-[420px] px-4 py-8">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <svg
            className="mx-auto mb-3 h-10 w-10 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-gray-500">
            {error ?? "This link is no longer available"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[420px] px-4 py-6 sm:max-w-3xl">
      {/* Clinic branding header */}
      <div className="mb-4 flex items-center gap-3">
        {org?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={org.logo_url}
            alt={org.name}
            className="h-8 w-8 rounded-lg object-contain"
          />
        )}
        {org?.name && (
          <span className="text-sm font-medium text-gray-600">
            {org.name}
          </span>
        )}
      </div>

      {/* File info */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">{file.name}</h1>
          <p className="text-xs text-gray-500">
            PDF &middot; {formatFileSize(file.size_bytes)}
          </p>
        </div>
        <a
          href={file.signed_url}
          download={`${file.name}.pdf`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-500 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 transition-colors"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
          </svg>
          Download
        </a>
      </div>

      {/* PDF viewer */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <iframe
          src={file.signed_url}
          className="h-[70vh] w-full"
          title={file.name}
        />
      </div>
    </div>
  );
}
