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
  // `rooms` and `paymentRooms` are projections of roomsWithClinicians —
  // derive them with selectRooms / selectPaymentRooms below.
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
    (set, get) => {
      /**
       * Build a refresh action: fetch a slice, bail (with a console error)
       * on failure, drop stale responses when the user has switched
       * locations mid-flight, then apply the payload as a state patch.
       */
      function makeRefresh<T>(spec: {
        name: string;
        action: string;
        locationScoped?: boolean;
        fetcher: (id: string) => Promise<{ ok: true; data: T } | { ok: false; error: string }>;
        apply: (data: T) => Partial<ClinicStore>;
      }) {
        return async (id: string) => {
          const result = await spec.fetcher(id);
          if (!result.ok) {
            console.error(`Failed to refresh ${spec.name}:`, result.error);
            return;
          }
          if (spec.locationScoped && get().locationId !== id) return;
          set(spec.apply(result.data), false, spec.action);
        };
      }

      return {
      // Initial state
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

      // Individual refresh actions — all share the makeRefresh shape:
      // fetch → log-and-bail on error → (optionally) drop stale responses
      // after a location switch → apply the payload as a state patch.
      refreshSessions: makeRefresh({
        name: "sessions",
        action: "refreshSessions",
        locationScoped: true,
        fetcher: (locationId: string) =>
          getJson<{ sessions: RunsheetSession[] }>(
            `/api/runsheet?locationId=${locationId}`
          ),
        apply: (data) => ({
          sessions: data.sessions,
          sessionsLoaded: true,
          sessionsFetchedAt: Date.now(),
        }),
      }),

      refreshRooms: makeRefresh({
        name: "rooms",
        action: "refreshRooms",
        locationScoped: true,
        fetcher: (locationId: string) =>
          getJson<{ rooms: RoomWithClinicians[] }>(
            `/api/settings/rooms?location_id=${locationId}`
          ),
        apply: (data) => ({
          roomsWithClinicians: data.rooms ?? [],
          roomsLoaded: true,
          roomsFetchedAt: Date.now(),
        }),
      }),

      refreshReadiness: makeRefresh({
        name: "readiness",
        action: "refreshReadiness",
        locationScoped: true,
        fetcher: async (locationId: string) => {
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
          if (!preResult.ok) return preResult;
          if (!postResult.ok) return postResult;
          return { ok: true as const, data: { pre: preResult.data, post: postResult.data } };
        },
        apply: ({ pre, post }) => ({
          readinessAppointmentsPre: pre.appointments ?? [],
          readinessAppointmentsPost: post.appointments ?? [],
          readinessCounts: {
            pre: pre.counts?.pre ?? pre.appointments?.length ?? 0,
            post: post.counts?.post ?? post.appointments?.length ?? 0,
          },
          readinessLoadedPre: true,
          readinessLoadedPost: true,
          readinessFetchedAt: Date.now(),
        }),
      }),

      refreshForms: makeRefresh({
        name: "forms",
        action: "refreshForms",
        fetcher: (orgId: string) =>
          getJson<{ forms: FormRow[] }>(`/api/forms?org_id=${orgId}`),
        apply: (data) => ({ forms: data.forms ?? [], formsLoaded: true }),
      }),

      refreshFiles: makeRefresh({
        name: "files",
        action: "refreshFiles",
        fetcher: (orgId: string) =>
          getJson<{ files: FileRow[] }>(`/api/files?org_id=${orgId}`),
        apply: (data) => ({ files: data.files ?? [], filesLoaded: true }),
      }),

      refreshStandaloneSubmissions: makeRefresh({
        name: "standalone submissions",
        action: "refreshStandaloneSubmissions",
        fetcher: (orgId: string) =>
          getJson<{ submissions: StandaloneSubmissionRow[] }>(
            `/api/forms/standalone/submissions?org_id=${orgId}&status=pending`
          ),
        apply: (data) => ({
          standaloneSubmissions: data.submissions ?? [],
          standaloneSubmissionsLoaded: true,
        }),
      }),

      refreshWorkflows: makeRefresh({
        name: "workflows",
        action: "refreshWorkflows",
        // One request: the init route returns both directions + forms.
        fetcher: (orgId: string) =>
          getJson<{
            appointment_types: AppointmentTypeRow[];
            outcome_pathways: OutcomePathwayRow[];
            forms: { id: string; name: string }[];
            pre_templates: Record<string, DbWorkflowTemplate>;
            pre_blocks: Record<string, DbWorkflowActionBlock[]>;
            post_templates: Record<string, DbWorkflowTemplate>;
            post_blocks: Record<string, DbWorkflowActionBlock[]>;
          }>(`/api/workflows/init?org_id=${orgId}`),
        apply: (data) => ({
          appointmentTypes: data.appointment_types,
          outcomePathways: data.outcome_pathways ?? [],
          preWorkflowTemplates: data.pre_templates,
          preWorkflowBlocks: data.pre_blocks,
          postWorkflowTemplates: data.post_templates,
          postWorkflowBlocks: data.post_blocks,
          workflowsLoaded: true,
        }),
      }),

      refreshPaymentConfig: makeRefresh({
        name: "payment config",
        action: "refreshPaymentConfig",
        locationScoped: true,
        // paymentRooms is derived from roomsWithClinicians (same
        // /api/settings/rooms payload); here we only need the config itself.
        fetcher: (locationId: string) =>
          getJson<PaymentsData>(`/api/settings/payments?location_id=${locationId}`),
        apply: (data) => ({ paymentConfig: data, paymentConfigLoaded: true }),
      }),

      refreshClinicianRoomIds: makeRefresh({
        name: "clinician room IDs",
        action: "refreshClinicianRoomIds",
        locationScoped: true,
        fetcher: (locationId: string) =>
          getJson<{ roomIds: string[] }>(
            `/api/runsheet/clinician-rooms?location_id=${locationId}`
          ),
        apply: (data) => ({
          clinicianRoomIds: data.roomIds ?? [],
          clinicianRoomIdsLoaded: true,
        }),
      }),

      // Direct setters
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
            roomsWithClinicians: [],
            sessions: [],
            readinessAppointmentsPre: [],
            readinessAppointmentsPost: [],
            readinessDirection: 'pre_appointment' as ReadinessDirection,
            readinessCounts: { pre: 0, post: 0 },
            clinicianRoomIds: [],
            paymentConfig: null,
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
      };
    },
    { name: "clinic-store" }
  )
);

// Helper: access store outside of React components (e.g., in Realtime callbacks)
// Usage: getClinicStore().mergeSessionUpdate(payload)
export const getClinicStore = () => useClinicStore.getState();

// ---------------------------------------------------------------------------
// Derived projections of roomsWithClinicians. Memoized on the source array's
// identity so useClinicStore(selectRooms) keeps a stable reference between
// store updates that don't touch rooms.
// ---------------------------------------------------------------------------

let roomsSource: RoomWithClinicians[] | null = null;
let roomsProjection: Room[] = [];

export function selectRooms(s: ClinicStore): Room[] {
  if (s.roomsWithClinicians !== roomsSource) {
    roomsSource = s.roomsWithClinicians;
    roomsProjection = s.roomsWithClinicians.map((r) => ({
      id: r.id,
      location_id: r.location_id,
      name: r.name,
      room_type: r.room_type,
      link_token: r.link_token,
      sort_order: r.sort_order,
      payments_enabled: r.payments_enabled ?? false,
    }));
  }
  return roomsProjection;
}

let paymentRoomsSource: RoomWithClinicians[] | null = null;
let paymentRoomsProjection: RoomPayment[] = [];

export function selectPaymentRooms(s: ClinicStore): RoomPayment[] {
  if (s.roomsWithClinicians !== paymentRoomsSource) {
    paymentRoomsSource = s.roomsWithClinicians;
    paymentRoomsProjection = s.roomsWithClinicians.map((r) => ({
      id: r.id,
      name: r.name,
      room_type: r.room_type,
      payments_enabled: r.payments_enabled ?? false,
    }));
  }
  return paymentRoomsProjection;
}
