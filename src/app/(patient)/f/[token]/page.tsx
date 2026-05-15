import { headers } from "next/headers";
import { StandaloneFormClient } from "@/components/patient/standalone-form-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * Standalone form entry point. The page is a thin server component that
 * fetches the form via the standalone API and hands it to the client. The API
 * is the security boundary — page never bypasses it.
 *
 * Possible outcomes after fetch:
 *   - 200: form is shareable, client renders the full flow.
 *   - 404 typed body: form exists but isn't shareable. Client renders
 *     "unavailable" with branding.
 *   - 404 flat: token doesn't match a form. Client renders generic "link
 *     isn't valid" with no branding.
 */
export default async function StandaloneFormPage({ params }: PageProps) {
  const { token } = await params;

  // Build absolute URL for the server-side fetch so we hit the same origin.
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "localhost:3000";
  const protocol = hdrs.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${protocol}://${host}`;

  const res = await fetch(`${baseUrl}/api/forms/standalone/${token}`, {
    cache: "no-store",
  });

  if (res.status === 200) {
    const data = await res.json();
    return (
      <StandaloneFormClient
        token={token}
        kind="shareable"
        form={data.form}
        org={data.org}
      />
    );
  }

  if (res.status === 404) {
    // Distinguish typed-404 (unavailable) from flat-404 (invalid).
    let body: { available?: boolean; reason?: string; org?: { name: string; logo_url: string | null } } | null = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    if (body && body.available === false && body.reason) {
      return (
        <StandaloneFormClient
          token={token}
          kind="unavailable"
          reason={body.reason as "draft" | "archived" | "unavailable"}
          org={body.org ?? null}
        />
      );
    }

    return <StandaloneFormClient token={token} kind="invalid" />;
  }

  // Unexpected — treat as invalid.
  return <StandaloneFormClient token={token} kind="invalid" />;
}
