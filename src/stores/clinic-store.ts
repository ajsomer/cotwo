import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { RunsheetSession, Room, SessionStatus } from "@/lib/supabase/types";
import type { DbWorkflowTemplate, DbWorkflowActionBlock } from "@/lib/workflows/types";
import type {
  AppointmentTypeRow,
  OutcomePathwayRow,
  FormRow,
  FileRow,
  StandaloneSubmissionRow,
  WorkflowAction,
  OutstandingForm,
  ReadinessDirection,
  ReadinessCounts,
  CompletedFormSubmission,
  ReadinessAppointment,
  RoomClinician,
  RoomWithClinicians,
  ClinicianAccount,
  PaymentsData,
  RoomPayment,
  OnboardingStage,
  OnboardingState,
} from "./clinic/types";

// Re-export row interfaces so existing consumers (`@/stores/clinic-store`)
// don't need to change their import path.
export type {
  AppointmentTypeRow,
  OutcomePathwayRow,
  FormRow,
  FileRow,
  StandaloneSubmissionRow,
  WorkflowAction,
  OutstandingForm,
  ReadinessDirection,
  ReadinessCounts,
  CompletedFormSubmission,
  ReadinessAppointment,
  RoomClinician,
  RoomWithClinicians,
  ClinicianAccount,
  PaymentsData,
  RoomPayment,
  OnboardingStage,
  OnboardingState,
};

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
  files: FileRow[];
  standaloneSubmissions: StandaloneSubmissionRow[];
  preWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  preWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  postWorkflowTemplates: Record<string, DbWorkflowTemplate>;
  postWorkflowBlocks: Record<string, DbWorkflowActionBlock[]>;
  outcomePathways: OutcomePathwayRow[];
  paymentConfig: PaymentsData | null;
  paymentRooms: RoomPayment[];

  // Tier 2: Volatile
  sessions: RunsheetSession[];
  readinessAppointmentsPre: ReadinessAppointment[];
  readinessAppointmentsPost: ReadinessAppointment[];
  readinessDirection: ReadinessDirection;
  readinessCounts: ReadinessCounts;

  // Tier 3: Real-time
  connectedSessions: Set<string>;

  // User-scoped (does not reset on location switch)
  onboarding: OnboardingState;
  onboardingLoaded: boolean;

  // Metadata
  locationId: string | null;
  orgId: string | null;

  // Loaded flags (per-slice — pages check these for first-load skeletons)
  roomsLoaded: boolean;
  sessionsLoaded: boolean;
  readinessLoadedPre: boolean;
  readinessLoadedPost: boolean;
  formsLoaded: boolean;
  filesLoaded: boolean;
  standaloneSubmissionsLoaded: boolean;
  workflowsLoaded: boolean;
  paymentConfigLoaded: boolean;
  clinicianRoomIdsLoaded: boolean;

  // Per-slice last-fetched timestamps (epoch ms). Used by the Socket.IO
  // connect handler to skip refetches that would race with a fresh SSR
  // hydration on cold load.
  sessionsFetchedAt: number | null;
  readinessFetchedAt: number | null;
  roomsFetchedAt: number | null;

  // --- Actions ---

  // Refresh all location-scoped data (client-side fetches)
  refreshLocationData: (locationId: string) => Promise<void>;

  // Refresh individual slices (client-side fetches)
  refreshSessions: (locationId: string) => Promise<void>;
  refreshRooms: (locationId: string) => Promise<void>;
  refreshReadiness: (locationId: string) => Promise<void>;
  refreshForms: (orgId: string) => Promise<void>;
  refreshFiles: (orgId: string) => Promise<void>;
  refreshStandaloneSubmissions: (orgId: string) => Promise<void>;
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
  setReadinessDirection: (direction: ReadinessDirection) => void;
  setReadinessCounts: (counts: ReadinessCounts) => void;
  setForms: (forms: FormRow[]) => void;
  setFiles: (files: FileRow[]) => void;
  setStandaloneSubmissions: (rows: StandaloneSubmissionRow[]) => void;
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
  setOnboarding: (state: Partial<OnboardingState>) => void;

  // Reset location-scoped data on location switch
  resetLocationData: () => void;

  // Reset user-scoped onboarding state — call on logout / in-tab user change
  // so the next user doesn't briefly see the previous user's onboarding stage
  // before the /api/onboarding/state fetch resolves.
  resetOnboarding: () => void;
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
      files: [],
      standaloneSubmissions: [],
      preWorkflowTemplates: {},
      preWorkflowBlocks: {},
      postWorkflowTemplates: {},
      postWorkflowBlocks: {},
      outcomePathways: [],
      paymentConfig: null,
      paymentRooms: [],
      sessions: [],
      readinessAppointmentsPre: [],
      readinessAppointmentsPost: [],
      readinessDirection: 'pre_appointment' as ReadinessDirection,
      readinessCounts: { pre: 0, post: 0 },
      connectedSessions: new Set(),
      onboarding: {
        stage: 'not_started',
        hasSeenPatientJourney: false,
        testSessionId: null,
        coachMarkDismissed: {},
      },
      onboardingLoaded: false,
      locationId: null,
      orgId: null,
      roomsLoaded: false,
      sessionsLoaded: false,
      readinessLoadedPre: false,
      readinessLoadedPost: false,
      formsLoaded: false,
      filesLoaded: false,
      standaloneSubmissionsLoaded: false,
      workflowsLoaded: false,
      paymentConfigLoaded: false,
      clinicianRoomIdsLoaded: false,
      sessionsFetchedAt: null,
      readinessFetchedAt: null,
      roomsFetchedAt: null,

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
          // Stale-response guard: if the user switched locations mid-fetch,
          // drop this response so we don't paint location A's data over B's.
          if (get().locationId !== locationId) return;
          set(
            { sessions: data.sessions, sessionsLoaded: true, sessionsFetchedAt: Date.now() },
            false,
            "refreshSessions"
          );
        } catch (e) {
          console.error("Failed to refresh sessions:", e);
        }
      },

      refreshRooms: async (locationId) => {
        try {
          const data = await fetchJson<{ rooms: RoomWithClinicians[] }>(
            `/api/settings/rooms?location_id=${locationId}`
          );
          if (get().locationId !== locationId) return;
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
            { rooms, roomsWithClinicians, roomsLoaded: true, roomsFetchedAt: Date.now() },
            false,
            "refreshRooms"
          );
        } catch (e) {
          console.error("Failed to refresh rooms:", e);
        }
      },

      refreshReadiness: async (locationId) => {
        try {
          const [preData, postData] = await Promise.all([
            fetchJson<{
              appointments: ReadinessAppointment[];
              counts?: ReadinessCounts;
            }>(`/api/readiness?location_id=${locationId}&direction=pre_appointment`),
            fetchJson<{
              appointments: ReadinessAppointment[];
              counts?: ReadinessCounts;
            }>(`/api/readiness?location_id=${locationId}&direction=post_appointment`),
          ]);
          if (get().locationId !== locationId) return;
          set(
            {
              readinessAppointmentsPre: preData.appointments ?? [],
              readinessAppointmentsPost: postData.appointments ?? [],
              readinessCounts: {
                pre: preData.counts?.pre ?? preData.appointments?.length ?? 0,
                post: postData.counts?.post ?? postData.appointments?.length ?? 0,
              },
              readinessLoadedPre: true,
              readinessLoadedPost: true,
              readinessFetchedAt: Date.now(),
            },
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

      refreshFiles: async (orgId) => {
        try {
          const data = await fetchJson<{ files: FileRow[] }>(
            `/api/files?org_id=${orgId}`
          );
          set({ files: data.files ?? [], filesLoaded: true }, false, "refreshFiles");
        } catch (e) {
          console.error("Failed to refresh files:", e);
        }
      },

      refreshStandaloneSubmissions: async (orgId) => {
        try {
          const data = await fetchJson<{
            submissions: StandaloneSubmissionRow[];
          }>(`/api/forms/standalone/submissions?org_id=${orgId}&status=pending`);
          set(
            {
              standaloneSubmissions: data.submissions ?? [],
              standaloneSubmissionsLoaded: true,
            },
            false,
            "refreshStandaloneSubmissions"
          );
        } catch (e) {
          console.error("Failed to refresh standalone submissions:", e);
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
              outcome_pathways: OutcomePathwayRow[];
              templates: Record<string, DbWorkflowTemplate>;
              blocks: Record<string, DbWorkflowActionBlock[]>;
            }>(`/api/workflows/init?org_id=${orgId}&direction=post_appointment`),
          ]);
          set(
            {
              appointmentTypes: preData.appointment_types,
              outcomePathways: postData.outcome_pathways ?? [],
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
          if (get().locationId !== locationId) return;
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
          if (get().locationId !== locationId) return;
          set(
            { clinicianRoomIds: data.roomIds ?? [], clinicianRoomIdsLoaded: true },
            false,
            "refreshClinicianRoomIds"
          );
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
      setReadinessAppointments: (appointments) => {
        const direction = get().readinessDirection;
        if (direction === 'pre_appointment') {
          set({ readinessAppointmentsPre: appointments, readinessLoadedPre: true }, false, "setReadinessAppointments");
        } else {
          set({ readinessAppointmentsPost: appointments, readinessLoadedPost: true }, false, "setReadinessAppointments");
        }
      },
      setReadinessDirection: (direction) => {
        // Instant switch — data is already cached in the per-direction slots
        set({ readinessDirection: direction }, false, "setReadinessDirection");
      },
      setReadinessCounts: (counts) =>
        set({ readinessCounts: counts }, false, "setReadinessCounts"),
      setForms: (forms) => set({ forms, formsLoaded: true }, false, "setForms"),
      setFiles: (files) => set({ files, filesLoaded: true }, false, "setFiles"),
      setStandaloneSubmissions: (rows) =>
        set(
          { standaloneSubmissions: rows, standaloneSubmissionsLoaded: true },
          false,
          "setStandaloneSubmissions"
        ),
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
        set(
          { clinicianRoomIds: ids, clinicianRoomIdsLoaded: true },
          false,
          "setClinicianRoomIds"
        ),
      setConnectedSessions: (sessions) =>
        set({ connectedSessions: sessions }, false, "setConnectedSessions"),
      setOnboarding: (partial) =>
        set(
          (s) => ({
            onboarding: { ...s.onboarding, ...partial },
            onboardingLoaded: true,
          }),
          false,
          "setOnboarding"
        ),

      resetOnboarding: () =>
        set(
          {
            onboarding: {
              stage: 'not_started',
              hasSeenPatientJourney: false,
              testSessionId: null,
              coachMarkDismissed: {},
            },
            onboardingLoaded: false,
          },
          false,
          "resetOnboarding"
        ),

      // Reset location-scoped data on location switch
      resetLocationData: () => {
        set(
          {
            rooms: [],
            roomsWithClinicians: [],
            sessions: [],
            readinessAppointmentsPre: [],
            readinessAppointmentsPost: [],
            readinessDirection: 'pre_appointment' as ReadinessDirection,
            readinessCounts: { pre: 0, post: 0 },
            clinicianRoomIds: [],
            paymentConfig: null,
            paymentRooms: [],
            connectedSessions: new Set(),
            roomsLoaded: false,
            sessionsLoaded: false,
            readinessLoadedPre: false,
            readinessLoadedPost: false,
            paymentConfigLoaded: false,
            clinicianRoomIdsLoaded: false,
            sessionsFetchedAt: null,
            readinessFetchedAt: null,
            roomsFetchedAt: null,
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
