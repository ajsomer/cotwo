"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getJson, postJson } from "@/lib/api-client";
import { getCurrentUserName } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Trash2, Plus, CheckCircle2 } from "lucide-react";

interface RoomRow {
  id: string;
  // dbId is set when the row corresponds to an existing DB row. New rows
  // (added via "Add another room") have only a local id.
  dbId?: string;
  name: string;
}

function makeId() {
  return crypto.randomUUID();
}

export default function SetupRoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [imported, setImported] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusLast = useRef(false);

  useEffect(() => {
    async function init() {
      const result = await getJson<{
        rooms?: { id: string; name: string; sort_order: number }[];
        imported?: boolean;
      }>("/api/setup/rooms");
      const data = result.ok ? result.data : null;
      const existing = data?.rooms ?? [];

      if (existing.length > 0) {
        setRooms(
          existing.map((r) => ({ id: makeId(), dbId: r.id, name: r.name }))
        );
        setImported(!!data?.imported);
      } else {
        // Pre-fill with user's full name (no "Room" suffix)
        const fullName = (await getCurrentUserName()) ?? "Room 1";
        setRooms([{ id: makeId(), name: fullName }]);
      }
      setInitialized(true);
    }
    init();
  }, []);

  // Focus last input when a new row is added
  useEffect(() => {
    if (shouldFocusLast.current && lastInputRef.current) {
      lastInputRef.current.focus();
      shouldFocusLast.current = false;
    }
  }, [rooms.length]);

  const addRoom = useCallback(() => {
    shouldFocusLast.current = true;
    setRooms((prev) => [...prev, { id: makeId(), name: "" }]);
  }, []);

  const updateRoom = useCallback((id: string, name: string) => {
    setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));
  }, []);

  const removeRoom = useCallback((id: string) => {
    setRooms((prev) => prev.filter((r) => r.id !== id));
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    if (e.key === "Enter" && index === rooms.length - 1) {
      e.preventDefault();
      addRoom();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Validate non-empty names
    const errs: Record<string, string> = {};
    rooms.forEach((r) => {
      if (!r.name.trim()) errs[r.id] = "Room name is required.";
    });
    if (rooms.length === 0) errs.form = "At least one room is required.";
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setLoading(true);

    const result = await postJson("/api/setup/rooms", {
      rooms: rooms.map((r, i) => ({
        id: r.dbId,
        name: r.name.trim(),
        sort_order: i,
      })),
    });

    if (!result.ok) {
      setLoading(false);
      setErrors({ form: result.error });
      return;
    }

    router.push("/setup/payments");
  }

  if (!initialized) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold text-gray-800">
          Create your rooms
        </h1>
        <div className="h-11 bg-gray-100 rounded-lg animate-pulse" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <h1 className="text-xl font-semibold text-gray-800">
        {imported ? "Review your rooms" : "Create your rooms"}
      </h1>
      <p className="text-sm text-gray-500">
        {imported
          ? "We've set these up from your Gentu data. Edit, delete, or add rooms as needed."
          : "Rooms group sessions on your run sheet. Common setups: one room per clinician, a shared room for rotating staff, or an on-demand room for walk-ins. You can change this later in Settings."}
      </p>

      {errors.form && (
        <p className="text-sm text-red-500">{errors.form}</p>
      )}

      <div className="space-y-2">
        {rooms.map((room, index) => (
          <div key={room.id} className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                ref={index === rooms.length - 1 ? lastInputRef : undefined}
                type="text"
                value={room.name}
                onChange={(e) => updateRoom(room.id, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, index)}
                placeholder="Room name"
                disabled={loading}
                className={`w-full h-11 px-3 ${imported && room.dbId ? "pr-9" : ""} text-sm border rounded-lg outline-none transition-colors ${
                  errors[room.id]
                    ? "border-red-500 focus:border-red-500"
                    : "border-gray-200 focus:border-teal-500"
                }`}
              />
              {imported && room.dbId && (
                <CheckCircle2
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500"
                  aria-label="Imported from Gentu"
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => removeRoom(room.id)}
              disabled={rooms.length <= 1 || loading}
              className="p-2 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:text-gray-400 transition-colors"
              aria-label={`Remove ${room.name || "room"}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRoom}
        disabled={loading}
        className="flex items-center gap-1.5 text-sm font-medium text-teal-500 hover:text-teal-600 transition-colors disabled:opacity-50"
      >
        <Plus size={16} />
        Add another room
      </button>

      <Button
        type="submit"
        variant="primary"
        className="w-full"
        disabled={loading}
      >
        {loading ? "Saving..." : "Continue"}
      </Button>
    </form>
  );
}
