"use client";

// Central place to import LiveKit default styles once per app.
// Downstream components (video-call-panel, waiting-room) rely on these
// class names (.lk-*) being registered.
import "@livekit/components-styles";

export {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
