"use client";

import { useRef, useState, useCallback, type DragEvent } from "react";
import { Upload, X } from "lucide-react";

interface LogoUploadProps {
  value: File | null;
  onChange: (file: File | null) => void;
  error?: string;
}

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/jpg"];

export function LogoUpload({ value, onChange, error }: LogoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleFile = useCallback(
    (file: File) => {
      setValidationError(null);

      if (!ACCEPTED_TYPES.includes(file.type)) {
        setValidationError("Only PNG and JPG files are accepted.");
        return;
      }

      if (file.size > MAX_SIZE) {
        setValidationError("File must be under 2MB.");
        return;
      }

      setPreview(URL.createObjectURL(file));
      onChange(file);
    },
    [onChange]
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleRemove = useCallback(() => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [preview, onChange]);

  const displayError = validationError ?? error;

  if (value && preview) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-800 mb-1.5">
          Logo (optional)
        </label>
        <div className="flex items-center gap-3">
          <img
            src={preview}
            alt="Logo preview"
            className="w-12 h-12 rounded-lg object-cover border border-gray-200"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="text-xs text-gray-500 hover:text-red-500 flex items-center gap-1 transition-colors"
          >
            <X size={14} />
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-800 mb-1.5">
        Logo (optional)
      </label>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload logo"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors ${
          dragOver
            ? "border-teal-500 bg-teal-50"
            : "border-gray-200 hover:border-gray-300"
        }`}
      >
        <Upload size={20} className="text-gray-400" />
        <span className="text-sm text-gray-500">
          Drop an image here or click to browse
        </span>
        <span className="text-xs text-gray-400">PNG or JPG, max 2MB</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {displayError && (
        <p className="mt-1 text-xs text-red-500">{displayError}</p>
      )}
    </div>
  );
}
