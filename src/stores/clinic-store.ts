import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { RunsheetSession, Room, SessionStatus } from "@/lib/supabase/types";
import type { DbWorkflowTemplate, DbWorkflowActionBlock } from "@/lib/workflows/types";

// ---------------------------------------------------------------------------
// Types used by shell components — re-exported here so pages import from one place
// ---------------------------------------------------------------------------

export interface AppointmentTypeRow {
  id: string;
  name: string;
  duration_minutes: number;
  default_fee_cents: number;
  modality: string;
  source: string;
  pms_provider: string | null;
  pre_workflow_template_id: string | null;
  action_count: number;
  in_flight_count: number;
}

export interface OutcomePathwayRow {
  id: string;
  name: string;
  description: string | null;
  workflow_template_id: string | null;
  template: DbWorkflowTemplate | null;
  blocks: DbWorkflowActionBlock[];
  action_count: number;
}

export interface FormRow {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  schema: Record<string, unknown>;
  updated_at: string;
  assignment_counts: { total: number; completed: number };
}

export interface WorkflowAction {
  action_id: string;
  action_type: string;
  action_label: string;
  status: string;
  scheduled_for: string;
  fired_at: string | null;
  error_message: string | null;
  form_name: string | null;
  offset_minutes: number;
  offset_direction: string;
}

export interface OutstandingForm {
  assignment_id: string;
  form_name: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

export interface ReadinessAppointment {
  appointment_id: string;
  scheduled_at: string;
  patient_id: string;
  patient_first_name: string;
  patient_last_name: string;
  clinician_name: string | null;
  primary_phone: string | null;
  total_actions: number;
  completed_actions: number;
  outstanding_actions: number;
  actions: WorkflowAction[];
  outstanding_forms: OutstandingForm[];
}

export interface RoomClinician {
  staff_assignment_id: string;
  full_name: string;
}

export interface RoomWithClinicians {
  id: string;
  location_id: string;
  name: string;
  room_type: "clinical" | "reception" | "shared" | "triage";
  link_token: string;
  sort_order: number;
  payments_enabled: boolean;
  clinicians: RoomClinician[];
}

export interface ClinicianAccount {
  staff_assignment_id: string;
  user_id: string;
  role: string;
  full_name: string;
  stripe_account_id: string | null;
}

export interface PaymentsData {
  routing_mode: "location" | "clinician";
  location_stripe_account_id: string | null;
  clinicians: ClinicianAccount[];
}

export interface RoomPayment {
  id: string;
  name: string;
  room_type: "clinical" | "reception" | "shared" | "triage";
  payments_enabled: boolean;
}

// ---------------------------------------------------------------------------
// Initial data shape — passed from server component to hydrate the store
// ---------------------------------------------------------------------------

export interface ClinicInitialData {
  sessions: RunsheetSession[];
  rooms: Room[];
  clinicianRoomIds: string[];
  readinessAppointments: ReadinessAppointment[];
  forms: FormRow[];
  appointmentTypes: AppointmentTypeRow[];
  outcomePathways: OutcomePathwayRow[];
  preWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  preWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  postWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  postWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  paymentConfig: PaymentsData | null;
  paymentRooms: RoomPayment[];
  roomsWithClinicians: RoomWithClinicians[];
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface ClinicStore {
  // Tier 1: Stable
  rooms: Room[];
  roomsWithClinicians: RoomWithClinicians[];
  appointmentTypes: AppointmentTypeRow[];
  clinicianRoomIds: string[];
  forms: FormRow[];
  preWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  preWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  postWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  postWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  outcomePathways: OutcomePathwayRow[];
  paymentConfig: PaymentsData | null;
  paymentRooms: RoomPayment[];

  // Tier 2: Volatile
  sessions: RunsheetSession[];
  readinessAppointments: ReadinessAppointment[];

  // Tier 3: Real-time
  connectedSessions: Set<string>;

  // Metadata
  locationId: string | null;
  orgId: string | null;

  // Loaded flags (per-slice — pages check these for first-load skeletons)
  roomsLoaded: boolean;
  sessionsLoaded: boolean;
  readinessLoaded: boolean;
  formsLoaded: boolean;
  workflowsLoaded: boolean;
  paymentConfigLoaded: boolean;

  // --- Actions ---

  // Hydrate the entire store from server-side initial data
  hydrateFromInitialData: (
    locationId: string,
    orgId: string,
    data: ClinicInitialData
  ) => void;

  // Refresh all location-scoped data (client-side fetches)
  refreshLocationData: (locationId: string) => Promise<void>;

  // Refresh individual slices (client-side fetches)
  refreshSessions: (locationId: string) => Promise<void>;
  refreshRooms: (locationId: string) => Promise<void>;
  refreshReadiness: (locationId: string) => Promise<void>;
  refreshForms: (orgId: string) => Promise<void>;
  refreshWorkflows: (orgId: string) => Promise<void>;
  refreshPaymentConfig: (locationId: string) => Promise<void>;
  refreshClinicianRoomIds: (locationId: string) => Promise<void>;

  // Merge a realtime session update (partial update, no full refetch)
  mergeSessionUpdate: (payload: {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
  }) => void;

  // Direct setters (for optimistic updates and Realtime handlers)
  setRooms: (rooms: Room[]) => void;
  setRoomsWithClinicians: (rooms: RoomWithClinicians[]) => void;
  setSessions: (sessions: RunsheetSession[]) => void;
  setReadinessAppointments: (appointments: ReadinessAppointment[]) => void;
  setForms: (forms: FormRow[]) => void;
  setAppointmentTypes: (types: AppointmentTypeRow[]) => void;
  setOutcomePathways: (pathways: OutcomePathwayRow[]) => void;
  setPreWorkflowTemplates: (templates: Record<string, DbWorkflowTemplate>) => void;
  setPreWorkflowBlocks: (blocks: Record<string, DbWorkflowActionBlock[]>) => void;
  setPostWorkflowTemplates: (templates: Record<string, DbWorkflowTemplate>) => void;
  setPostWorkflowBlocks: (blocks: Record<string, DbWorkflowActionBlock[]>) => void;
  setPaymentConfig: (config: PaymentsData | null) => void;
  setPaymentRooms: (rooms: RoomPayment[]) => void;
  setClinicianRoomIds: (ids: string[]) => void;
  setConnectedSessions: (sessions: Set<string>) => void;

  // Reset location-scoped data on location switch
  resetLocationData: () => void;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

export const useClinicStore = create<ClinicStore>()(
  devtools(
    (set, get) => ({
      // Initial state
      rooms: [],
      roomsWithClinicians: [],
      appointmentTypes: [],
      clinicianRoomIds: [],
      forms: [],
      preWorkflowTemplates: {},
      preWorkflowBlocks: {},
      postWorkflowTemplates: {},
      postWorkflowBlocks: {},
      outcomePathways: [],
      paymentConfig: null,
      paymentRooms: [],
      sessions: [],
      readinessAppointments: [],
      connectedSessions: new Set(),
      locationId: null,
      orgId: null,
      roomsLoaded: false,
      sessionsLoaded: false,
      readinessLoaded: false,
      formsLoaded: false,
      workflowsLoaded: false,
      paymentConfigLoaded: false,

      // Hydrate from server-side initial data (synchronous, no fetch)
      hydrateFromInitialData: (locationId, orgId, data) => {
        set(
          {
            locationId,
            orgId,
            sessions: data.sessions,
            rooms: data.rooms,
            clinicianRoomIds: data.clinicianRoomIds,
            readinessAppointments: data.readinessAppointments,
            forms: data.forms,
            appointmentTypes: data.appointmentTypes,
            outcomePathways: data.outcomePathways,
            preWorkflowTemplates: data.preWorkflowTemplates,
            preWorkflowBlocks: data.preWorkflowBlocks,
            postWorkflowTemplates: data.postWorkflowTemplates,
            postWorkflowBlocks: data.postWorkflowBlocks,
            paymentConfig: data.paymentConfig,
            paymentRooms: data.paymentRooms,
            roomsWithClinicians: data.roomsWithClinicians,
            roomsLoaded: true,
            sessionsLoaded: true,
            readinessLoaded: true,
            formsLoaded: true,
            workflowsLoaded: true,
            paymentConfigLoaded: true,
          },
          false,
          "hydrateFromInitialData"
        );
      },

      // Refresh all location-scoped data
      refreshLocationData: async (locationId) => {
        const state = get();
        await Promise.all([
          state.refreshSessions(locationId),
          state.refreshRooms(locationId),
          state.refreshReadiness(locationId),
          state.refreshPaymentConfig(locationId),
          state.refreshClinicianRoomIds(locationId),
        ]);
      },

      // Individual refresh actions
      refreshSessions: async (locationId) => {
        try {
          const data = await fetchJson<{ sessions: RunsheetSession[] }>(
            `/api/runsheet?locationId=${locationId}&_t=${Date.now()}`
          );
          set({ sessions: data.sessions, sessionsLoaded: true }, false, "refreshSessions");
        } catch (e) {
          console.error("Failed to refresh sessions:", e);
        }
      },

      refreshRooms: async (locationId) => {
        try {
          const data = await fetchJson<{ rooms: RoomWithClinicians[] }>(
            `/api/settings/rooms?location_id=${locationId}`
          );
          const roomsWithClinicians = data.rooms ?? [];
          // Derive basic Room[] from the settings response
          const rooms: Room[] = roomsWithClinicians.map((r) => ({
            id: r.id,
            location_id: r.location_id,
            name: r.name,
            room_type: r.room_type,
            link_token: r.link_token,
            sort_order: r.sort_order,
            payments_enabled: r.payments_enabled ?? false,
          }));
          set(
            { rooms, roomsWithClinicians, roomsLoaded: true },
            false,
            "refreshRooms"
          );
        } catch (e) {
          console.error("Failed to refresh rooms:", e);
        }
      },

      refreshReadiness: async (locationId) => {
        try {
          const data = await fetchJson<{ appointments: ReadinessAppointment[] }>(
            `/api/readiness?location_id=${locationId}`
          );
          set(
            { readinessAppointments: data.appointments ?? [], readinessLoaded: true },
            false,
            "refreshReadiness"
          );
        } catch (e) {
          console.error("Failed to refresh readiness:", e);
        }
      },

      refreshForms: async (orgId) => {
        try {
          const data = await fetchJson<{ forms: FormRow[] }>(
            `/api/forms?org_id=${orgId}`
          );
          set({ forms: data.forms ?? [], formsLoaded: true }, false, "refreshForms");
        } catch (e) {
          console.error("Failed to refresh forms:", e);
        }
      },

      refreshWorkflows: async (orgId) => {
        try {
          const [preData, postData] = await Promise.all([
            fetchJson<{
              appointment_types: AppointmentTypeRow[];
              outcome_pathways: OutcomePathwayRow[];
              forms: { id: string; name: string }[];
              templates: Record<string, DbWorkflowTemplate>;
              blocks: Record<string, DbWorkflowActionBlock[]>;
            }>(`/api/workflows/init?org_id=${orgId}&direction=pre_appointment`),
            fetchJson<{
              templates: Record<string, DbWorkflowTemplate>;
              blocks: Record<string, DbWorkflowActionBlock[]>;
            }>(`/api/workflows/init?org_id=${orgId}&direction=post_appointment`),
          ]);
          set(
            {
              appointmentTypes: preData.appointment_types,
              outcomePathways: preData.outcome_pathways,
              preWorkflowTemplates: preData.templates,
              preWorkflowBlocks: preData.blocks,
              postWorkflowTemplates: postData.templates,
              postWorkflowBlocks: postData.blocks,
              workflowsLoaded: true,
            },
            false,
            "refreshWorkflows"
          );
        } catch (e) {
          console.error("Failed to refresh workflows:", e);
        }
      },

      refreshPaymentConfig: async (locationId) => {
        try {
          const [config, roomsData] = await Promise.all([
            fetchJson<PaymentsData>(
              `/api/settings/payments?location_id=${locationId}`
            ),
            fetchJson<{ rooms: RoomWithClinicians[] }>(
              `/api/settings/rooms?location_id=${locationId}`
            ),
          ]);
          const paymentRooms: RoomPayment[] = (roomsData.rooms ?? []).map(
            (r) => ({
              id: r.id,
              name: r.name,
              room_type: r.room_type,
              payments_enabled: r.payments_enabled ?? false,
            })
          );
          set(
            { paymentConfig: config, paymentRooms: paymentRooms, paymentConfigLoaded: true },
            false,
            "refreshPaymentConfig"
          );
        } catch (e) {
          console.error("Failed to refresh payment config:", e);
        }
      },

      refreshClinicianRoomIds: async (locationId) => {
        try {
          const data = await fetchJson<{ roomIds: string[] }>(
            `/api/runsheet/clinician-rooms?location_id=${locationId}`
          );
          set({ clinicianRoomIds: data.roomIds ?? [] }, false, "refreshClinicianRoomIds");
        } catch (e) {
          console.error("Failed to refresh clinician room IDs:", e);
        }
      },

      // Merge a realtime session update
      mergeSessionUpdate: (payload) => {
        const updated = payload.new;
        const sessionId = updated.id as string;
        const locationId = get().locationId;

        if (updated.location_id !== locationId) return;

        if (payload.eventType === "INSERT") {
          // New session — need full joined data, trigger refetch
          if (locationId) get().refreshSessions(locationId);
          return;
        }

        if (payload.eventType === "DELETE") {
          set(
            (state) => ({
              sessions: state.sessions.filter(
                (s) => s.session_id !== (payload.old.id as string)
              ),
            }),
            false,
            "mergeSessionUpdate:delete"
          );
          return;
        }

        // UPDATE — merge specific fields in place
        set(
          (state) => ({
            sessions: state.sessions.map((s) =>
              s.session_id === sessionId
                ? {
                    ...s,
                    status: updated.status as SessionStatus,
                    notification_sent: updated.notification_sent as boolean,
                    notification_sent_at:
                      updated.notification_sent_at as string | null,
                    patient_arrived: updated.patient_arrived as boolean,
                    patient_arrived_at:
                      updated.patient_arrived_at as string | null,
                    session_started_at:
                      updated.session_started_at as string | null,
                    session_ended_at: updated.session_ended_at as string | null,
                    video_call_id: updated.video_call_id as string | null,
                  }
                : s
            ),
          }),
          false,
          "mergeSessionUpdate:update"
        );
      },

      // Direct setters
      setRooms: (rooms) => set({ rooms, roomsLoaded: true }, false, "setRooms"),
      setRoomsWithClinicians: (rooms) =>
        set({ roomsWithClinicians: rooms }, false, "setRoomsWithClinicians"),
      setSessions: (sessions) =>
        set({ sessions, sessionsLoaded: true }, false, "setSessions"),
      setReadinessAppointments: (appointments) =>
        set(
          { readinessAppointments: appointments, readinessLoaded: true },
          false,
          "setReadinessAppointments"
        ),
      setForms: (forms) => set({ forms, formsLoaded: true }, false, "setForms"),
      setAppointmentTypes: (types) =>
        set({ appointmentTypes: types }, false, "setAppointmentTypes"),
      setOutcomePathways: (pathways) =>
        set({ outcomePathways: pathways }, false, "setOutcomePathways"),
      setPreWorkflowTemplates: (templates) =>
        set({ preWorkflowTemplates: templates }, false, "setPreWorkflowTemplates"),
      setPreWorkflowBlocks: (blocks) =>
        set({ preWorkflowBlocks: blocks }, false, "setPreWorkflowBlocks"),
      setPostWorkflowTemplates: (templates) =>
        set({ postWorkflowTemplates: templates }, false, "setPostWorkflowTemplates"),
      setPostWorkflowBlocks: (blocks) =>
        set({ postWorkflowBlocks: blocks }, false, "setPostWorkflowBlocks"),
      setPaymentConfig: (config) =>
        set({ paymentConfig: config }, false, "setPaymentConfig"),
      setPaymentRooms: (rooms) =>
        set({ paymentRooms: rooms }, false, "setPaymentRooms"),
      setClinicianRoomIds: (ids) =>
        set({ clinicianRoomIds: ids }, false, "setClinicianRoomIds"),
      setConnectedSessions: (sessions) =>
        set({ connectedSessions: sessions }, false, "setConnectedSessions"),

      // Reset location-scoped data on location switch
      resetLocationData: () => {
        set(
          {
            rooms: [],
            roomsWithClinicians: [],
            sessions: [],
            readinessAppointments: [],
            clinicianRoomIds: [],
            paymentConfig: null,
            paymentRooms: [],
            connectedSessions: new Set(),
            roomsLoaded: false,
            sessionsLoaded: false,
            readinessLoaded: false,
            paymentConfigLoaded: false,
          },
          false,
          "resetLocationData"
        );
      },
    }),
    { name: "clinic-store" }
  )
);

// Helper: access store outside of React components (e.g., in Realtime callbacks)
// Usage: getClinicStore().mergeSessionUpdate(payload)
export const getClinicStore = () => useClinicStore.getState();
