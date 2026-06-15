"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, postJson } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "@/hooks/useLocation";
import { useRole } from "@/hooks/useRole";
import type { TelephonyConfigDTO } from "@/lib/telephony/config-service";

interface StaffOption {
  userId: string;
  fullName: string;
}

/**
 * Settings panel for the Twilio call-pop TEST trigger. Internal tool: connect a
 * Twilio account, pick whose screen pops, and copy the webhook URLs to paste
 * into Twilio. Mirrors the PMS integrations shell's connect/status shape.
 */
export function PhoneTestSettingsShell() {
  const { selectedLocation } = useLocation();
  const { userId } = useRole();
  const locationId = selectedLocation?.id ?? null;

  const [config, setConfig] = useState<TelephonyConfigDTO | null>(null);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Connect-form fields
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [demoUserId, setDemoUserId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!locationId) return;
    const [cfg, st] = await Promise.all([
      getJson<TelephonyConfigDTO>(`/api/telephony/connection?locationId=${locationId}`),
      getJson<{ staff: StaffOption[] }>(`/api/telephony/staff?locationId=${locationId}`),
    ]);
    if (cfg.ok) {
      setConfig(cfg.data);
      setAccountSid(cfg.data.twilioAccountSid ?? "");
      setPhoneNumber(cfg.data.twilioPhoneNumber ?? "");
      setDemoUserId(cfg.data.demoUserId ?? userId ?? "");
    }
    if (st.ok) setStaff(st.data.staff);
    setLoading(false);
  }, [locationId, userId]);

  useEffect(() => {
    let cancelled = false;
    if (!locationId) return;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, load]);

  const handleConnect = async () => {
    if (!locationId) return;
    setSaving(true);
    setError(null);
    const result = await postJson<TelephonyConfigDTO>("/api/telephony/connection", {
      locationId,
      twilioAccountSid: accountSid.trim(),
      authToken: authToken.trim(),
      twilioPhoneNumber: phoneNumber.trim(),
      demoUserId: demoUserId || userId,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setConfig(result.data);
    setAuthToken(""); // never keep the secret in component state after save
  };

  const handleDisconnect = async () => {
    if (!locationId) return;
    setSaving(true);
    await fetch(`/api/telephony/connection?locationId=${locationId}`, { method: "DELETE" });
    setSaving(false);
    await load();
  };

  if (loading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-800">Phone (testing)</h1>
        <p className="text-sm text-gray-500 mt-1">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold text-gray-800">Phone (testing)</h1>
      <p className="text-sm text-gray-500 mt-1">
        Internal call-pop test trigger. Dial your Twilio number from a patient&apos;s
        phone number and their card pops on the chosen screen. Not a phone-system
        integration.
      </p>

      {config?.configured ? (
        <div className="mt-6 space-y-5">
          <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Badge variant="green">Configured</Badge>
              <span className="text-sm text-gray-600">
                {config.twilioPhoneNumber}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              Last test call:{" "}
              {config.lastEventAt
                ? new Date(config.lastEventAt).toLocaleString()
                : "none yet"}
            </p>

            <div className="space-y-2 pt-2">
              <CopyRow label="Voice webhook (A Call Comes In)" value={config.webhookUrl} />
              <CopyRow label="Status callback URL" value={config.statusCallbackUrl} />
              <p className="text-xs text-gray-500">
                In Twilio, set the number&apos;s &quot;A Call Comes In&quot; webhook to the
                voice URL, and its call status changes callback to the status URL.
              </p>
            </div>
          </div>

          <Button variant="secondary" onClick={handleDisconnect} disabled={saving}>
            {saving ? "Working…" : "Disconnect"}
          </Button>
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5 space-y-4">
          <Field label="Twilio Account SID">
            <input
              className={inputClass}
              value={accountSid}
              onChange={(e) => setAccountSid(e.target.value)}
              placeholder="ACxxxxxxxx…"
            />
          </Field>
          <Field label="Twilio Auth Token">
            <input
              className={inputClass}
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder="••••••••"
            />
          </Field>
          <Field label="Twilio phone number (E.164)">
            <input
              className={inputClass}
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+61…"
            />
          </Field>
          <Field label="Pop on this user's screen">
            <select
              className={inputClass}
              value={demoUserId}
              onChange={(e) => setDemoUserId(e.target.value)}
            >
              <option value="">Select a user…</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.fullName}
                </option>
              ))}
            </select>
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button
            onClick={handleConnect}
            disabled={
              saving ||
              !accountSid.trim() ||
              !authToken.trim() ||
              !phoneNumber.trim() ||
              !(demoUserId || userId)
            }
          >
            {saving ? "Connecting…" : "Connect"}
          </Button>
        </div>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      {children}
    </label>
  );
}

function CopyRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5 text-xs text-gray-700">
          {value}
        </code>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(value)}
          className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
