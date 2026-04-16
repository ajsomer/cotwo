# LiveKit Integration

Telehealth video calls for the clinician and the patient

April 2026

**CONFIDENTIAL**

## Overview

| **Surface** | Clinician video view (launched from run sheet Admit), patient video view (launched from waiting room on admit) |
| --- | --- |
| **Users** | Clinicians (host the call), patients (join from waiting room) |
| **Available to** | Core + Complete tiers, telehealth sessions only |
| **Priority** | Demo feature — this is the moment the run sheet stops being a schedule and becomes a live operational tool |

LiveKit is the prototype's stand-in for Coviu's proprietary video platform. The integration needs to do four things: generate a room identity per session, mint short-lived access tokens for the clinician and the patient, connect both parties into the same room on admit, and tear down the room when the clinician ends the call. Nothing more. No recording, no screen share, no multi-participant, no device picker beyond the defaults LiveKit gives us.

The existing `admit` flow already creates a `video_call_id` stub (`room-{sessionId}-{timestamp}`). That value becomes the LiveKit room name. Everything downstream — token generation, client connection — keys off it.

## Data Model

No schema changes. `sessions.video_call_id` already exists and is populated by `admitPatient()`. We'll change the format from the current stub to a cleaner room name and start actually using it.

**Room naming convention**: `session-{sessionId}`. Deterministic, derivable, no timestamp suffix needed — one session, one room. If a session is somehow re-admitted (shouldn't happen given the state machine, but), the same room name is reused, which LiveKit handles as a reconnect.

The `sessions.video_call_id` column stays for audit/debugging but becomes redundant with the naming convention. Leave it populated (`session-{id}`) for now; the production system will likely route through Coviu's own video service and use this column for that foreign key.

## Environment

Already configured in `.env.local`:

```
NEXT_PUBLIC_LIVEKIT_URL=wss://...
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
```

Packages already installed:

- `livekit-client@2.18.0` — browser SDK, used by both clinician and patient
- `@livekit/components-react@2.9.20` — prebuilt React components (`LiveKitRoom`, `VideoConference`, control bar, participant tiles)

Server-side JWT minting needs the `livekit-server-sdk` package — **not yet installed**. Add it.

## Token Generation

New file: `src/lib/livekit/tokens.ts` (currently an empty stub).

Single function:

```ts
export async function generateAccessToken(params: {
  sessionId: string;
  identity: string;         // "clinician-{userId}" or "patient-{patientId or sessionId}"
  name: string;             // Display name shown in the video tile
  role: "clinician" | "patient";
}): Promise<string>
```

Uses `AccessToken` from `livekit-server-sdk`. Grants:

- `roomJoin: true`
- `room: session-{sessionId}`
- `canPublish: true`, `canSubscribe: true` for both roles
- `canPublishData: true` for the clinician only (future: chat, control messages)

TTL: 1 hour from issue. Long enough to cover the call, short enough that a leaked token doesn't matter. No refresh — if a call runs over an hour, the participant reconnects and gets a fresh token.

## API Routes

### `POST /api/livekit/token`

Mints a token for the authenticated *clinician* to join a session. The clinician is authenticated via the normal Supabase session cookie.

**Request body:** `{ sessionId: string }`

**Validation:**
1. Resolve `auth.uid()` to a `users` row.
2. Load the session. Verify the user is assigned to the session's room (via `clinician_room_assignments`) OR is a clinic owner / practice manager (admin override — useful for the demo).
3. Verify the session's status is `in_session` (LiveKit only runs during active calls).

**Response:** `{ token: string, url: string, roomName: string }`

### `POST /api/patient/livekit/token`

Mints a token for the *patient* to join a session. Patients are not auth users — they authenticate via the entry token.

**Request body:** `{ entryToken: string }`

**Validation:**
1. Resolve `entryToken` to a session via `sessions.entry_token`.
2. Verify session status is `in_session`. If `waiting`, return 409 — the patient is in the waiting room and shouldn't have a token yet.
3. Uses the service role client (same pattern as other patient-facing endpoints) to bypass RLS.

**Response:** same shape as the clinician route.

Both routes are the only place `LIVEKIT_API_SECRET` is read. It never leaves the server.

## Clinician Video View

New component: `src/components/clinic/video-call-panel.tsx`.

Rendered as a full-screen modal on top of the run sheet when a session's `video_call_id` is set and the clinician has opted to join (see trigger below). The run sheet continues to render underneath, which means realtime updates still flow — the clinician can see their next appointment go from `queued` to `upcoming` while they're in a call.

**Trigger**: Today, clicking "Admit" on a `waiting` session fires `admitPatient()` and the session transitions to `in_session`. The run sheet shows the in-session state but the clinician is never connected. Fix this by wiring admit → video panel open:

- `runsheet-shell.tsx` already handles the `admit` action. After `admitPatient()` resolves successfully, set local state `activeCallSessionId = sessionId` which mounts the video panel.
- If the clinician closes the panel without ending the call (X button, or navigates away), the call keeps running — they can rejoin via a new "Rejoin call" action button that appears on `in_session` rows for sessions they're assigned to.
- If they click "End call" in the panel, fire `markSessionComplete()` — same server action that already exists. Session transitions to `complete`, LiveKit disconnects, run sheet shows it in the Process queue.

**Composition:**

```tsx
<LiveKitRoom
  token={token}
  serverUrl={url}
  connect={true}
  video={true}
  audio={true}
  onDisconnected={handleDisconnect}
>
  <VideoConference />  {/* prebuilt component: tiles + control bar */}
</LiveKitRoom>
```

`VideoConference` from `@livekit/components-react` gives us participant tiles, mute/camera toggles, leave button, and device switching out of the box. Use it as-is for the prototype. Style overrides go in `globals.css` scoped to `.lk-*` classes to match Coviu's teal/gray palette (LiveKit ships with a dark theme by default — we'll want to check it doesn't clash).

**Leave button behaviour**: The default LiveKit leave button disconnects from the room but does *not* end the session. Override `onDisconnected` to open a confirmation: "End the appointment?" → Yes fires `markSessionComplete()`, No leaves the call running and dismisses the panel (clinician can rejoin).

**Edge case — patient disconnects**: If the patient's LiveKit connection drops (tab close, network loss), the clinician sees them leave the room. The session stays `in_session` because the clinician is still connected. The existing disconnect indicator on the session row (`patient_disconnected`) already handles this case via the Supabase presence channel — the video layer doesn't need to duplicate it.

## Patient Video View

Update: `src/components/patient/waiting-room.tsx`.

Currently when `session.status` transitions to `in_session`, the waiting room renders a placeholder box that says "Video call would launch here (LiveKit integration)". Replace this placeholder with a full LiveKit client.

**Flow:**

1. Realtime subscription picks up status → `in_session`.
2. Fetch a patient token via `POST /api/patient/livekit/token` with the entry token.
3. Mount `<LiveKitRoom>` + `<VideoConference>` same as the clinician view, but with patient-appropriate identity and name.
4. On disconnect (patient clicks leave, or clinician ends call and LiveKit disconnects them), render the existing "Appointment complete" screen.

**Pre-join check**: Before mounting the room, briefly show "Connecting to {clinician_name}..." while the token fetch is in flight. Avoids a jarring transition from waiting room → black video frame → video.

**Device permissions**: LiveKit prompts for camera/mic permission on first connect. If the patient completed the device test during the entry flow (Outstanding Items step), they've already granted permission — LiveKit will connect silently. If they skipped or denied, LiveKit surfaces its own permission UI. Acceptable for the prototype.

**Mobile viewport**: The waiting room is 420px max-width centred. The video panel should take the full viewport on the patient side (mobile-first, one-on-one call doesn't need chrome around it). Swap the layout: when `status === 'in_session'`, break out of the 420px container into a full-viewport `<LiveKitRoom>`.

## State Machine Integration

The existing session status machine stays unchanged. LiveKit is purely a presentation layer on top of `in_session`:

| Session status | Clinician view | Patient view |
|----------------|----------------|--------------|
| `waiting` | "Admit" button on row | Waiting room (no video yet) |
| `in_session` | Video panel (or "Rejoin call" button if dismissed) | Video panel (full viewport) |
| `complete` | Process flow | "Appointment complete" screen |
| `done` | Row dims to gray | Closed/dismissed |

LiveKit rooms are not eagerly created. They come into existence the moment the first participant joins. When both participants disconnect, LiveKit cleans the room up automatically after a short idle timeout (default 5 minutes). No explicit teardown API call needed.

## Failure Modes

**Token endpoint fails**: Patient sees a retry button. Clinician sees a toast and stays on the run sheet (the session is still `in_session` in the DB — they can hit Rejoin).

**LiveKit server unreachable** (`NEXT_PUBLIC_LIVEKIT_URL` wrong or down): `LiveKitRoom`'s `onError` fires. Show a friendly fallback: "Video connection failed. The appointment is still active — please refresh to try again." Log to console. This should not happen in the demo but needs to not crash the app if it does.

**Clinician refreshes during a call**: LiveKit reconnects automatically on mount. Because the room name is deterministic (`session-{id}`) and both parties have live tokens, they rejoin the same room. The patient sees a brief "Connecting..." flash when the clinician drops, then they're back.

**Multiple clinician tabs**: If a clinician opens the run sheet in two tabs and hits Admit in both (or Rejoin in one and the panel is already open in another), LiveKit will connect both sessions with the same identity. The server rejects duplicate identities by default — one tab will be kicked. Acceptable for the prototype; don't special-case it.

## Out of Scope for this Work

- **Recording**: LiveKit supports egress to S3/GCS. Not building it. Production will route through Coviu's own recording pipeline.
- **Screen share**: Control bar hides the share button via a custom `ControlBar` prop.
- **Chat / data channel**: `canPublishData: true` is set on the clinician token for future use, but no UI.
- **Group calls**: `session_participants` schema supports multi-party but the UI assumes 1:1. Token generation assumes a single clinician and a single patient per room.
- **Background blur / virtual backgrounds**: LiveKit supports via track processors. Not worth the complexity for a prototype.
- **Call quality indicators**: LiveKit exposes connection quality on the participant object. Display is fiddly; skip for demo.
- **Waiting-room-to-call transition polish**: TODO already flags this as a separate item. Keep the transition simple for now — the placeholder goes away, the `<LiveKitRoom>` mounts.

## Files Touched

| File | Change |
|------|--------|
| `package.json` | Add `livekit-server-sdk` dependency |
| `src/lib/livekit/tokens.ts` | Implement `generateAccessToken()` |
| `src/lib/livekit/client.ts` | Export a small wrapper around `LiveKitRoom` + `VideoConference` with Coviu-themed defaults; both clinician and patient views use it |
| `src/app/api/livekit/token/route.ts` | New — clinician token endpoint |
| `src/app/api/patient/livekit/token/route.ts` | New — patient token endpoint |
| `src/components/clinic/video-call-panel.tsx` | New — full-screen modal video panel |
| `src/components/clinic/runsheet-shell.tsx` | Wire admit → open video panel, add Rejoin action handler |
| `src/components/clinic/action-button.tsx` | Add "Rejoin" variant for `in_session` rows assigned to the current clinician |
| `src/components/patient/waiting-room.tsx` | Replace placeholder box with `<LiveKitRoom>` |
| `src/lib/runsheet/actions.ts` | Change `video_call_id` format from `room-{id}-{ts}` to `session-{id}` |
| `src/styles/globals.css` | LiveKit theme overrides for `.lk-*` classes |

## Demo Script

1. Receptionist view: run sheet shows a patient in `waiting` on Dr Smith's room.
2. Switch to clinician view (Dr Smith). Patient is waiting. Click Admit.
3. Video panel opens. LiveKit connects. Clinician sees their own camera preview.
4. Switch to patient tab (mobile viewport). Waiting room transitions to the video view. Patient joins the same room. Both participants see each other.
5. Clinician clicks End call. Confirmation → Yes. Session transitions to `complete`. Video panel closes. Run sheet shows the session ready to Process.
6. Patient side shows "Appointment complete".

That's the whole demo moment. Everything else (Process flow, payment, outcome pathway) is already working and kicks in immediately after End call.
