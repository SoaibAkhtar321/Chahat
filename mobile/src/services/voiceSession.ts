// Shared "a voice note is being recorded" flag. The microphone and the speaker must never run together:
// the mic would pick up the other person's voice note. Pure module (no native code) so every screen,
// the playback adapter and the tests read the same state.
import { useSyncExternalStore } from "react";

let recording = false;
const listeners = new Set<() => void>();

export function isRecordingSession(): boolean {
  return recording;
}

export function setRecordingSession(active: boolean): void {
  if (recording === active) return;
  recording = active;
  listeners.forEach((l) => l());
}

export function subscribeRecordingSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook: true while a voice note is being recorded (play buttons are disabled meanwhile). */
export function useRecordingSession(): boolean {
  return useSyncExternalStore(subscribeRecordingSession, isRecordingSession, isRecordingSession);
}

export const PLAYBACK_BLOCKED_BY_RECORDING = "Finish recording before playing a voice message.";

/** Formats milliseconds as m:ss for the voice note clock. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
