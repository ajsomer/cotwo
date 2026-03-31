"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogoUpload } from "@/components/ui/logo-upload";

export default function SetupClinicPage() {
  const router = useRouter();
  const [clinicName, setClinicName] = useState("");
  const [address, setAddress] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!clinicName.trim()) errs.clinicName = "Clinic name is required.";
    if (!address.trim()) errs.address = "Address is required.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);

    let logo_url: string | null = null;

    // Upload logo if provided
    if (logoFile) {
      const supabase = createClient();
      const ext = logoFile.name.split(".").pop();
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("org-logos")
        .upload(path, logoFile);

      if (uploadError) {
        setErrors({ logo: "Failed to upload logo. You can add it later in Settings." });
        // Continue without logo — it is optional
      } else {
        const { data: urlData } = supabase.storage
          .from("org-logos")
          .getPublicUrl(path);
        logo_url = urlData.publicUrl;
      }
    }

    const res = await fetch("/api/setup/clinic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: clinicName.trim(),
        address: address.trim(),
        logo_url,
      }),
    });

    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => null);
      setErrors({ form: data?.error ?? "Something went wrong. Please try again." });
      return;
    }

    router.push("/setup/rooms");
  }

  // Live initial placeholder
  const initial = clinicName.trim().charAt(0).toUpperCase();

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-800">
        Create your clinic
      </h1>
      <p className="text-sm text-gray-500">
        Tell us about your clinic. You can update these details later in
        Settings.
      </p>

      {errors.form && (
        <p className="text-sm text-red-500">{errors.form}</p>
      )}

      <Input
        label="Clinic name"
        type="text"
        value={clinicName}
        onChange={(e) => setClinicName(e.target.value)}
        error={errors.clinicName}
        placeholder="e.g. Sunrise Allied Health"
        autoFocus
        disabled={loading}
      />

      <Input
        label="Address"
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        error={errors.address}
        placeholder="e.g. 123 Oxford St, Bondi Junction NSW 2022"
        disabled={loading}
      />

      <div className="flex items-start gap-4">
        {!logoFile && initial && (
          <div className="w-12 h-12 rounded-lg bg-teal-50 border border-teal-200 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-semibold text-teal-600">
              {initial}
            </span>
          </div>
        )}
        <div className="flex-1">
          <LogoUpload
            value={logoFile}
            onChange={setLogoFile}
            error={errors.logo}
          />
        </div>
      </div>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={loading}
      >
        {loading ? "Creating clinic..." : "Continue"}
      </Button>
    </form>
  );
}
