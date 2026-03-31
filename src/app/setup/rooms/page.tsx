"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";

interface RoomRow {
  id: string;
  name: string;
}

function makeId() {
  return crypto.randomUUID();
}

export default function SetupRoomsPage() {
  const router = useRouter();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const shouldFocusLast = useRef(false);

  // Pre-fill first room with user's name
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const fullName =
        user?.user_metadata?.full_name ?? "My";
      const firstName = fullName.split(" ")[0];
      setRooms([{ id: makeId(), name: `${firstName}'s Room` }]);
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

    const res = await fetch("/api/setup/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rooms: rooms.map((r, i) => ({
          name: r.name.trim(),
          sort_order: i,
        })),
      }),
    });

    if (!res.ok) {
      setLoading(false);
      const data = await res.json().catch(() => null);
      setErrors({
        form: data?.error ?? "Something went wrong. Please try again.",
      });
      return;
    }

    router.push("/runsheet");
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
        Create your rooms
      </h1>
      <p className="text-sm text-gray-500">
        Rooms group sessions on your run sheet. Common setups: one room per
        clinician, a shared room for rotating staff, or an on-demand room for
        walk-ins. You can change this later in Settings.
      </p>

      {errors.form && (
        <p className="text-sm text-red-500">{errors.form}</p>
      )}

      <div className="space-y-2">
        {rooms.map((room, index) => (
          <div key={room.id} className="flex items-center gap-2">
            <input
              ref={index === rooms.length - 1 ? lastInputRef : undefined}
              type="text"
              value={room.name}
              onChange={(e) => updateRoom(room.id, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              placeholder="Room name"
              disabled={loading}
              className={`flex-1 h-11 px-3 text-sm border rounded-lg outline-none transition-colors ${
                errors[room.id]
                  ? "border-red-500 focus:border-red-500"
                  : "border-gray-200 focus:border-teal-500"
              }`}
            />
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
        {loading ? "Creating rooms..." : "Finish setup"}
      </Button>
    </form>
  );
}
