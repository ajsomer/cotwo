'use client';

import { useState, useCallback, useEffect } from 'react';
import { postJson } from '@/lib/api-client';
import type { PatientContact } from '@/lib/types/domain';
import type { IntakeJourneyContext } from './intake-journey';

export type Phase =
  | 'phone'
  | 'identity'
  | 'identity_picker'
  | 'identity_no_match'
  | 'checklist'
  | 'card'
  | 'consent'
  | 'form'
  | 'done';

export interface ConfirmContact {
  id: string;
  first_name: string;
  last_name: string;
}

export interface ItemSlot {
  key: string;
  kind: 'card' | 'consent' | 'form';
  label: string;
  formId?: string;
  complete: boolean;
}

export function buildItems(state: IntakeJourneyContext['journey']): ItemSlot[] {
  const list: ItemSlot[] = [];
  if (state.includes_card_capture) {
    list.push({
      key: 'card',
      kind: 'card',
      label: 'Store a card on file',
      complete: !!state.card_captured_at,
    });
  }
  if (state.includes_consent) {
    list.push({
      key: 'consent',
      kind: 'consent',
      label: 'Provide consent',
      complete: !!state.consent_completed_at,
    });
  }
  for (const f of state.forms) {
    list.push({
      key: `form:${f.id}`,
      kind: 'form',
      label: f.name,
      formId: f.id,
      complete: !!state.forms_completed?.[f.id],
    });
  }
  return list;
}

export function deriveInitialPhase(j: IntakeJourneyContext['journey']): Phase {
  if (j.status === 'completed') return 'done';
  // Fresh arrivals always start at phone verification. If the patient has
  // already been attached (via reminder link after a previous visit), we could
  // skip to checklist — but we still want phone ownership confirmed each
  // session. For simplicity, always re-verify.
  return 'phone';
}

export function computeStepNumber(
  phase: Phase,
  activeFormId: string | null,
  items: ItemSlot[]
): number | undefined {
  if (phase === 'phone') return 1;
  if (phase === 'identity') return 2;
  if (phase === 'checklist') return undefined;

  // For item phases, compute which step index we're at in the items list.
  const idx = items.findIndex((i) => {
    if (phase === 'card') return i.kind === 'card';
    if (phase === 'consent') return i.kind === 'consent';
    if (phase === 'form' && activeFormId)
      return i.kind === 'form' && i.formId === activeFormId;
    return false;
  });

  if (idx < 0) return undefined;
  return 2 + idx + 1; // phone + identity + this item's position
}

interface UseIntakeJourneyOptions {
  skipIdentity?: boolean;
  preConfirmedPatient?: PatientContact;
}

/**
 * The intake journey's phase machine: journey-row state, phase transitions,
 * identity resolution, and item navigation. The component renders from what
 * this returns; the completion/demo-redirect side effects stay with the
 * component.
 */
export function useIntakeJourney(
  context: IntakeJourneyContext,
  token: string,
  { skipIdentity, preConfirmedPatient }: UseIntakeJourneyOptions
) {
  const { journey, appointment } = context;

  // Progress is driven by the journey row — reload it after each item so late
  // arrivals via reminder link resume at the right place.
  const [state, setState] = useState(journey);

  const initialPhase: Phase =
    skipIdentity && preConfirmedPatient
      ? journey.status === 'completed'
        ? 'done'
        : 'checklist'
      : deriveInitialPhase(journey);

  const [rawPhase, setPhase] = useState<Phase>(initialPhase);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(
    appointment.prefill_phone
  );
  const [patient, setPatient] = useState<PatientContact | null>(
    preConfirmedPatient ?? null
  );
  const [pickerContacts, setPickerContacts] = useState<ConfirmContact[]>([]);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Journey completion overrides any local phase state — keeps the "done"
  // screen sticky even if rawPhase is stale from before the last reload.
  const phase: Phase = state.status === 'completed' ? 'done' : rawPhase;

  // Items list in fixed order. Used for the checklist screen and for
  // advancing between items.
  const items = buildItems(state);
  const itemsDone = items.filter((i) => i.complete).length;

  // Steps: phone, identity, (each configured item), done. Skip card/consent/forms
  // in stepper when not included. Checklist is not a numbered step.
  const totalSteps = 2 + items.length; // phone + identity + each item
  const currentStepNumber = computeStepNumber(phase, activeFormId, items);

  const reloadJourney = useCallback(async () => {
    const res = await fetch(`/api/intake/${token}`);
    if (!res.ok) return;
    const data = await res.json();
    setState((prev) => ({ ...prev, ...data.journey, forms: prev.forms }));
  }, [token]);

  const resolveIdentity = useCallback(
    async (phone: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/intake/${token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone_number: phone }),
        });
        const data = await res.json();

        if (data.status === 'matched') {
          setPatient({
            id: data.contact.id,
            first_name: data.contact.first_name,
            last_name: data.contact.last_name,
            date_of_birth: null,
          });
          await reloadJourney();
          setPhase('checklist');
          return;
        }

        if (data.status === 'multi_match') {
          setPickerContacts(data.contacts ?? []);
          setPhase('identity_picker');
          return;
        }

        // no_match or unexpected shape
        setPhase('identity_no_match');
      } catch {
        setError('Something went wrong. Please try again.');
      }
    },
    [token, reloadJourney]
  );

  const handlePhoneVerified = useCallback(
    (phone: string) => {
      setPhoneNumber(phone);
      setPhase('identity');
      resolveIdentity(phone);
    },
    [resolveIdentity]
  );

  const handlePickerChoice = useCallback(
    async (contact: ConfirmContact) => {
      setError(null);
      try {
        const res = await fetch(`/api/intake/${token}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone_number: phoneNumber,
            selected_patient_id: contact.id,
          }),
        });
        const data = await res.json();
        if (data.status !== 'matched') {
          setError('Unable to confirm contact. Please try again.');
          return;
        }
        setPatient({
          id: data.contact.id,
          first_name: data.contact.first_name,
          last_name: data.contact.last_name,
          date_of_birth: null,
        });
        await reloadJourney();
        setPhase('checklist');
      } catch {
        setError('Something went wrong. Please try again.');
      }
    },
    [token, phoneNumber, reloadJourney]
  );

  const goToItem = useCallback((item: ItemSlot | undefined) => {
    if (!item) {
      setPhase('done');
      return;
    }
    setActiveFormId(item.kind === 'form' ? item.formId! : null);
    if (item.kind === 'card') setPhase('card');
    else if (item.kind === 'consent') setPhase('consent');
    else setPhase('form');
  }, []);

  const advanceFromChecklist = useCallback(() => {
    goToItem(items.find((i) => !i.complete));
  }, [items, goToItem]);

  // After completing an item, skip the checklist and jump straight to the
  // next incomplete item. The checklist is a preview surface — patients see
  // it once at the start, or again if they resume via a reminder link —
  // not a landing pad between every step.
  const handleItemComplete = useCallback(async () => {
    const res = await fetch(`/api/intake/${token}`);
    if (!res.ok) {
      setPhase('checklist');
      setActiveFormId(null);
      return;
    }
    const data = await res.json();
    const nextState = { ...state, ...data.journey, forms: state.forms };
    setState(nextState);

    const nextItems = buildItems(nextState);
    const nextItem = nextItems.find((i) => !i.complete);
    goToItem(nextItem);
  }, [token, state, goToItem]);

  // Guard: if patient object missing but journey has patient_id (e.g. returning
  // via reminder link on a device that doesn't have state), hydrate the
  // display name from the journey row's contact so checklist headers can
  // greet the patient by name.
  useEffect(() => {
    if (phase !== 'checklist' && phase !== 'card' && phase !== 'consent' && phase !== 'form') {
      return;
    }
    if (patient || !state.patient_id) return;
    (async () => {
      const result = await postJson<{
        status?: string;
        contact?: { id: string; first_name: string; last_name: string };
      }>(`/api/intake/${token}/verify`, {
        phone_number: phoneNumber ?? 'resume',
        selected_patient_id: state.patient_id,
      });
      if (!result.ok) return;
      const data = result.data;
      if (data?.status === 'matched' && data.contact) {
        setPatient({
          id: data.contact.id,
          first_name: data.contact.first_name,
          last_name: data.contact.last_name,
          date_of_birth: null,
        });
      }
    })();
  }, [phase, patient, state.patient_id, token, phoneNumber]);

  return {
    state,
    phase,
    phoneNumber,
    patient,
    pickerContacts,
    activeFormId,
    error,
    items,
    itemsDone,
    totalSteps,
    currentStepNumber,
    handlePhoneVerified,
    handlePickerChoice,
    advanceFromChecklist,
    handleItemComplete,
  };
}
