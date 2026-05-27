"use client";

import { useEffect, useState } from "react";
import { useLocation } from "@/hooks/useLocation";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useClinicStore, getClinicStore } from "@/stores/clinic-store";
import type { PaymentsData, RoomPayment } from "@/stores/clinic-store";
import type { RoomType } from "@/lib/supabase/types";

type RoutingMode = "location" | "clinician";
type Tab = "configuration" | "rooms";

const ROOM_TYPE_BADGE: Record<
  RoomType,
  { label: string; variant: "teal" | "blue" | "amber" | "gray" }
> = {
  clinical: { label: "Clinical", variant: "teal" },
  reception: { label: "Reception", variant: "blue" },
  shared: { label: "Shared", variant: "amber" },
  triage: { label: "Triage", variant: "gray" },
};

export function PaymentsSettingsShell() {
  const { selectedLocation } = useLocation();
  const { role, userId } = useRole();
  const [tab, setTab] = useState<Tab>("configuration");
  const data = useClinicStore((s) => s.paymentConfig);
  const rooms = useClinicStore((s) => s.paymentRooms);
  const loading = !useClinicStore((s) => s.paymentConfigLoaded);

  // Fetch-if-empty
  useEffect(() => {
    if (!selectedLocation) return;
    if (!getClinicStore().paymentConfigLoaded) {
      void getClinicStore().refreshPaymentConfig(selectedLocation.id);
    }
  }, [selectedLocation]);
  const [saving, setSaving] = useState(false);

  const isAdmin =
    role === "clinic_owner" || role === "practice_manager";
  const isClinician = role === "clinician" || role === "clinic_owner";

  const refetchPayments = () => {
    if (selectedLocation) getClinicStore().refreshPaymentConfig(selectedLocation.id);
  };

  // Routing mode change
  const handleRoutingChange = async (mode: RoutingMode) => {
    if (!selectedLocation || !data || mode === data.routing_mode) return;

    const label = mode === "location" ? "Clinic" : "Per clinician";
    if (
      !confirm(
        `Change payment routing to "${label}"? This affects where payments are directed for all locations.`
      )
    )
      return;

    setSaving(true);
    try {
      const res = await fetch("/api/settings/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_routing",
          location_id: selectedLocation.id,
          routing_mode: mode,
        }),
      });
      if (res.ok) {
        if (data) getClinicStore().setPaymentConfig({ ...data, routing_mode: mode });
      }
    } finally {
      setSaving(false);
    }
  };

  // Connect Stripe account (stubbed)
  const handleConnect = async (
    target: "location" | "clinician",
    staffAssignmentId?: string
  ) => {
    if (!selectedLocation) return;

    if (!confirm("Connect test Stripe account?")) return;

    setSaving(true);
    try {
      const res = await fetch("/api/settings/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect_account",
          target,
          location_id: selectedLocation.id,
          staff_assignment_id: staffAssignmentId,
        }),
      });
      if (res.ok) {
        refetchPayments();
      }
    } finally {
      setSaving(false);
    }
  };

  // Disconnect Stripe account
  const handleDisconnect = async (
    target: "location" | "clinician",
    staffAssignmentId?: string
  ) => {
    if (!selectedLocation) return;

    if (!confirm("Disconnect Stripe account? Payments will be disabled."))
      return;

    setSaving(true);
    try {
      const res = await fetch("/api/settings/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disconnect_account",
          target,
          location_id: selectedLocation.id,
          staff_assignment_id: staffAssignmentId,
        }),
      });
      if (res.ok) {
        refetchPayments();
      }
    } finally {
      setSaving(false);
    }
  };

  // Room payment toggle — updates paymentRooms, rooms, and roomsWithClinicians
  const handleRoomToggle = async (roomId: string, enabled: boolean) => {
    const store = getClinicStore();

    // Optimistic update across all room slices
    store.setPaymentRooms(
      store.paymentRooms.map((r) =>
        r.id === roomId ? { ...r, payments_enabled: enabled } : r
      )
    );
    store.setRooms(
      store.rooms.map((r) =>
        r.id === roomId ? { ...r, payments_enabled: enabled } : r
      )
    );
    store.setRoomsWithClinicians(
      store.roomsWithClinicians.map((r) =>
        r.id === roomId ? { ...r, payments_enabled: enabled } : r
      )
    );

    const res = await fetch("/api/settings/rooms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: roomId, payments_enabled: enabled }),
    });

    if (!res.ok) {
      // Revert across all room slices
      store.setPaymentRooms(
        store.paymentRooms.map((r) =>
          r.id === roomId ? { ...r, payments_enabled: !enabled } : r
        )
      );
      store.setRooms(
        store.rooms.map((r) =>
          r.id === roomId ? { ...r, payments_enabled: !enabled } : r
        )
      );
      store.setRoomsWithClinicians(
        store.roomsWithClinicians.map((r) =>
          r.id === roomId ? { ...r, payments_enabled: !enabled } : r
        )
      );
    }
  };

  if (!selectedLocation) {
    return (
      <div className="p-6 text-sm text-gray-500">No location selected.</div>
    );
  }

  // Clinicians only see config tab in per-clinician mode
  if (role === "clinician" && data?.routing_mode !== "clinician") {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-semibold text-gray-800">
          Payment Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Payments are configured at the clinic level. Contact your practice
          manager for changes.
        </p>
      </div>
    );
  }

  const hasStripeConnected =
    data?.routing_mode === "location"
      ? !!data?.location_stripe_account_id
      : (data?.clinicians ?? []).some((c) => !!c.stripe_account_id);

  // Which tabs to show
  const showRoomsTab = isAdmin;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-800">
          Payment Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure payments for {selectedLocation.name}
        </p>
      </div>

      {/* Tabs */}
      {showRoomsTab && (
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setTab("configuration")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "configuration"
                ? "border-teal-500 text-teal-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Configuration
          </button>
          <button
            onClick={() => setTab("rooms")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === "rooms"
                ? "border-teal-500 text-teal-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Rooms
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 rounded-xl border border-gray-200 bg-white animate-pulse"
            />
          ))}
        </div>
      ) : tab === "configuration" ? (
        <ConfigurationTab
          data={data}
          isAdmin={isAdmin}
          isClinician={isClinician}
          userId={userId}
          saving={saving}
          locationName={selectedLocation.name}
          onRoutingChange={handleRoutingChange}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />
      ) : (
        <RoomsTab
          rooms={rooms}
          hasStripeConnected={hasStripeConnected}
          onToggle={handleRoomToggle}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Configuration Tab
// ---------------------------------------------------------------------------

function ConfigurationTab({
  data,
  isAdmin,
  isClinician,
  userId,
  saving,
  locationName,
  onRoutingChange,
  onConnect,
  onDisconnect,
}: {
  data: PaymentsData | null;
  isAdmin: boolean;
  isClinician: boolean;
  userId: string | null;
  saving: boolean;
  locationName: string;
  onRoutingChange: (mode: RoutingMode) => void;
  onConnect: (target: "location" | "clinician", saId?: string) => void;
  onDisconnect: (target: "location" | "clinician", saId?: string) => void;
}) {
  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* Routing mode toggle — admin only */}
      {isAdmin && (
        <section>
          <h2 className="text-base font-semibold text-gray-800 mb-1">
            Payment routing
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            Choose how payments are directed for this organisation.
          </p>

          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              onClick={() => onRoutingChange("location")}
              disabled={saving}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                data.routing_mode === "location"
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Clinic
            </button>
            <button
              onClick={() => onRoutingChange("clinician")}
              disabled={saving}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                data.routing_mode === "clinician"
                  ? "bg-white text-gray-800 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Per clinician
            </button>
          </div>
        </section>
      )}

      {/* Stripe Connect section */}
      <section>
        <h2 className="text-base font-semibold text-gray-800 mb-1">
          Stripe Connect
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          {data.routing_mode === "location"
            ? `Connect a Stripe account to accept payments at ${locationName}.`
            : "Each clinician connects their own Stripe account to receive payments directly."}
        </p>

        {data.routing_mode === "location" ? (
          // Clinic-level connect
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    data.location_stripe_account_id
                      ? "bg-green-500"
                      : "bg-gray-300"
                  }`}
                />
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    {locationName}
                  </p>
                  {data.location_stripe_account_id ? (
                    <p className="text-xs text-gray-500 font-mono mt-0.5">
                      {data.location_stripe_account_id}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Not connected
                    </p>
                  )}
                </div>
              </div>
              {isAdmin && (
                <div>
                  {data.location_stripe_account_id ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onDisconnect("location")}
                      disabled={saving}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => onConnect("location")}
                      disabled={saving}
                    >
                      Connect Stripe
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          // Per-clinician connect
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            {data.clinicians.length === 0 ? (
              <div className="p-5 text-sm text-gray-500 text-center">
                No clinicians assigned to this location.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {data.clinicians
                  .filter((c) => {
                    // Clinicians only see their own row
                    if (!isAdmin && isClinician) {
                      return c.user_id === userId;
                    }
                    return true;
                  })
                  .map((clinician) => {
                    const isOwnAccount = clinician.user_id === userId;
                    const canManage = isOwnAccount && isClinician;

                    return (
                      <div
                        key={clinician.staff_assignment_id}
                        className="flex items-center justify-between px-5 py-4"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-2.5 w-2.5 rounded-full ${
                              clinician.stripe_account_id
                                ? "bg-green-500"
                                : "bg-amber-400"
                            }`}
                          />
                          <div>
                            <p className="text-sm font-medium text-gray-800">
                              {clinician.full_name}
                            </p>
                            {clinician.stripe_account_id ? (
                              <p className="text-xs text-gray-500 font-mono mt-0.5">
                                {clinician.stripe_account_id}
                              </p>
                            ) : (
                              <p className="text-xs text-gray-400 mt-0.5">
                                Not connected
                              </p>
                            )}
                          </div>
                        </div>
                        <div>
                          {canManage ? (
                            clinician.stripe_account_id ? (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() =>
                                  onDisconnect(
                                    "clinician",
                                    clinician.staff_assignment_id
                                  )
                                }
                                disabled={saving}
                              >
                                Disconnect
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() =>
                                  onConnect(
                                    "clinician",
                                    clinician.staff_assignment_id
                                  )
                                }
                                disabled={saving}
                              >
                                Connect Stripe
                              </Button>
                            )
                          ) : isAdmin ? (
                            <span className="text-xs text-gray-400">
                              Clinician must connect
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rooms Tab
// ---------------------------------------------------------------------------

function RoomsTab({
  rooms,
  hasStripeConnected,
  onToggle,
}: {
  rooms: RoomPayment[];
  hasStripeConnected: boolean;
  onToggle: (roomId: string, enabled: boolean) => void;
}) {
  return (
    <div>
      <h2 className="text-base font-semibold text-gray-800 mb-1">
        Room payments
      </h2>
      <p className="text-sm text-gray-500 mb-4">
        Choose which rooms require patients to provide a payment method during
        check-in.
      </p>

      {!hasStripeConnected && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          Connect a Stripe account on the Configuration tab to enable payments.
        </div>
      )}

      {rooms.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">
            No rooms configured for this location.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
          {rooms.map((room) => {
            const typeConfig = ROOM_TYPE_BADGE[room.room_type] ?? {
              label: room.room_type,
              variant: "gray" as const,
            };

            return (
              <div
                key={room.id}
                className="flex items-center justify-between px-5 py-4"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-800">
                    {room.name}
                  </span>
                  <Badge variant={typeConfig.variant}>{typeConfig.label}</Badge>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={room.payments_enabled}
                    disabled={!hasStripeConnected}
                    onChange={(e) => onToggle(room.id, e.target.checked)}
                  />
                  <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-teal-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500 peer-disabled:opacity-50 peer-disabled:cursor-not-allowed" />
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
