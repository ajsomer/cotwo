"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { selectOutcomePathway } from "@/lib/runsheet/actions";
import type { EnrichedSession } from "@/lib/supabase/types";

interface OutcomePathway {
  id: string;
  name: string;
  description: string | null;
}

interface ProcessFlowOutcomeProps {
  session: EnrichedSession;
  onNext: () => void;
}

export function ProcessFlowOutcome({ session, onNext }: ProcessFlowOutcomeProps) {
  const [pathways, setPathways] = useState<OutcomePathway[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchPathways() {
      const supabase = createClient();
      const { data } = await supabase
        .from("outcome_pathways")
        .select("id, name, description")
        .order("name");
      setPathways((data ?? []) as OutcomePathway[]);
    }
    fetchPathways();
  }, []);

  async function handleConfirm() {
    if (!selectedId) return;
    setLoading(true);
    await selectOutcomePathway(session.session_id, selectedId);
    setLoading(false);
    onNext();
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
          Select outcome pathway
        </p>

        <div className="space-y-2">
          {pathways.map((pathway) => (
            <button
              key={pathway.id}
              onClick={() => setSelectedId(pathway.id)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${
                selectedId === pathway.id
                  ? "border-teal-500 bg-teal-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <p className="text-sm font-medium text-gray-800">
                {pathway.name}
              </p>
              {pathway.description && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {pathway.description}
                </p>
              )}
            </button>
          ))}

          {pathways.length === 0 && (
            <p className="text-sm text-gray-500">No outcome pathways configured</p>
          )}
        </div>
      </div>

      <div className="space-y-2 pt-2">
        <Button
          className="w-full"
          disabled={!selectedId || loading}
          onClick={handleConfirm}
        >
          {loading ? "Saving..." : "Confirm"}
        </Button>
        <button
          onClick={onNext}
          className="w-full text-center text-xs text-gray-500 hover:text-gray-800 py-2"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
