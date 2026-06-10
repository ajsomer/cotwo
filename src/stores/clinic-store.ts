import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { getJson } from "@/lib/api-client";
import type { RunsheetSession, Room } from "@/lib/types/domain";
import type { DbWorkflowTemplate, DbWorkflowActionBlock } from "@/lib/workflows/types";
import type {
  AppointmentTypeRow,
  OutcomePathwayRow,
  FormRow,
  FileRow,
  StandaloneSubmissionRow,
  WorkflowAction,
  IntakeItem,
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
  IntakeItem,
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

      // Individual refresh actions
      refreshSessions: async (locationId) => {
        const result = await getJson<{ sessions: RunsheetSession[] }>(
          `/api/runsheet?locationId=${locationId}`
        );
        if (!result.ok) {
          console.error("Failed to refresh sessions:", result.error);
          return;
        }
        // Stale-response guard: if the user switched locations mid-fetch,
        // drop this response so we don't paint location A's data over B's.
        if (get().locationId !== locationId) return;
        set(
          { sessions: result.data.sessions, sessionsLoaded: true, sessionsFetchedAt: Date.now() },
          false,
          "refreshSessions"
        );
      },

      refreshRooms: async (locationId) => {
        const result = await getJson<{ rooms: RoomWithClinicians[] }>(
          `/api/settings/rooms?location_id=${locationId}`
        );
        if (!result.ok) {
          console.error("Failed to refresh rooms:", result.error);
          return;
        }
        if (get().locationId !== locationId) return;
        const roomsWithClinicians = result.data.rooms ?? [];
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
        // paymentRooms is a projection of the same rooms — derive it here so
        // refreshPaymentConfig doesn't re-fetch /api/settings/rooms.
        const paymentRooms: RoomPayment[] = roomsWithClinicians.map((r) => ({
          id: r.id,
          name: r.name,
          room_type: r.room_type,
          payments_enabled: r.payments_enabled ?? false,
        }));
        set(
          { rooms, roomsWithClinicians, paymentRooms, roomsLoaded: true, roomsFetchedAt: Date.now() },
          false,
          "refreshRooms"
        );
      },

      refreshReadiness: async (locationId) => {
        const [preResult, postResult] = await Promise.all([
          getJson<{
            appointments: ReadinessAppointment[];
            counts?: ReadinessCounts;
          }>(`/api/tasks?location_id=${locationId}&direction=pre_appointment`),
          getJson<{
            appointments: ReadinessAppointment[];
            counts?: ReadinessCounts;
          }>(`/api/tasks?location_id=${locationId}&direction=post_appointment`),
        ]);
        if (!preResult.ok) {
          console.error("Failed to refresh readiness:", preResult.error);
          return;
        }
        if (!postResult.ok) {
          console.error("Failed to refresh readiness:", postResult.error);
          return;
        }
        const preData = preResult.data;
        const postData = postResult.data;
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
      },

      refreshForms: async (orgId) => {
        const result = await getJson<{ forms: FormRow[] }>(
          `/api/forms?org_id=${orgId}`
        );
        if (!result.ok) {
          console.error("Failed to refresh forms:", result.error);
          return;
        }
        set({ forms: result.data.forms ?? [], formsLoaded: true }, false, "refreshForms");
      },

      refreshFiles: async (orgId) => {
        const result = await getJson<{ files: FileRow[] }>(
          `/api/files?org_id=${orgId}`
        );
        if (!result.ok) {
          console.error("Failed to refresh files:", result.error);
          return;
        }
        set({ files: result.data.files ?? [], filesLoaded: true }, false, "refreshFiles");
      },

      refreshStandaloneSubmissions: async (orgId) => {
        const result = await getJson<{
          submissions: StandaloneSubmissionRow[];
        }>(`/api/forms/standalone/submissions?org_id=${orgId}&status=pending`);
        if (!result.ok) {
          console.error("Failed to refresh standalone submissions:", result.error);
          return;
        }
        set(
          {
            standaloneSubmissions: result.data.submissions ?? [],
            standaloneSubmissionsLoaded: true,
          },
          false,
          "refreshStandaloneSubmissions"
        );
      },

      refreshWorkflows: async (orgId) => {
        // One request: the init route returns both directions + forms.
        const result = await getJson<{
          appointment_types: AppointmentTypeRow[];
          outcome_pathways: OutcomePathwayRow[];
          forms: { id: string; name: string }[];
          pre_templates: Record<string, DbWorkflowTemplate>;
          pre_blocks: Record<string, DbWorkflowActionBlock[]>;
          post_templates: Record<string, DbWorkflowTemplate>;
          post_blocks: Record<string, DbWorkflowActionBlock[]>;
        }>(`/api/workflows/init?org_id=${orgId}`);
        if (!result.ok) {
          console.error("Failed to refresh workflows:", result.error);
          return;
        }
        const data = result.data;
        set(
          {
            appointmentTypes: data.appointment_types,
            outcomePathways: data.outcome_pathways ?? [],
            preWorkflowTemplates: data.pre_templates,
            preWorkflowBlocks: data.pre_blocks,
            postWorkflowTemplates: data.post_templates,
            postWorkflowBlocks: data.post_blocks,
            workflowsLoaded: true,
          },
          false,
          "refreshWorkflows"
        );
      },

      refreshPaymentConfig: async (locationId) => {
        // paymentRooms is derived in refreshRooms (same /api/settings/rooms
        // payload); here we only need the payment config itself.
        const result = await getJson<PaymentsData>(
          `/api/settings/payments?location_id=${locationId}`
        );
        if (!result.ok) {
          console.error("Failed to refresh payment config:", result.error);
          return;
        }
        if (get().locationId !== locationId) return;
        set(
          { paymentConfig: result.data, paymentConfigLoaded: true },
          false,
          "refreshPaymentConfig"
        );
      },

      refreshClinicianRoomIds: async (locationId) => {
        const result = await getJson<{ roomIds: string[] }>(
          `/api/runsheet/clinician-rooms?location_id=${locationId}`
        );
        if (!result.ok) {
          console.error("Failed to refresh clinician room IDs:", result.error);
          return;
        }
        if (get().locationId !== locationId) return;
        set(
          { clinicianRoomIds: result.data.roomIds ?? [], clinicianRoomIdsLoaded: true },
          false,
          "refreshClinicianRoomIds"
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
