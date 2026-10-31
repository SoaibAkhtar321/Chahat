// Pure rules for the "ongoing call" notification (no React Native imports, unit tested). While a video call is
// connected, a quiet persistent notification says "Tap to return to call", like WhatsApp.
import { isValidUUID } from "../utils/validation";

export const ONGOING_CALL_CHANNEL_ID = "ongoing_call";
export const ONGOING_CALL_CATEGORY = "ongoing_call";
export const ONGOING_CALL_NOTIFICATION_ID = "chahat-ongoing-call";

export interface OngoingCallData {
  callId: string;
  matchId: string;
}

/** Validates the data of a tapped ongoing-call notification. Nothing here is trusted: the server is asked next. */
export function parseOngoingCallData(data: unknown): OngoingCallData | null {
  if (!data || typeof data !== "object") return null;
  const { category, callId, matchId } = data as Record<string, unknown>;
  if (category !== ONGOING_CALL_CATEGORY) return null;
  if (typeof callId !== "string" || !isValidUUID(callId)) return null;
  if (typeof matchId !== "string" || !isValidUUID(matchId)) return null;
  return { callId: callId.toLowerCase(), matchId: matchId.toLowerCase() };
}

/** True when the app is already showing the call screen, so a tap must not open a second copy of it. */
export function isOnCallScreen(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && pathname.startsWith("/call/");
}

/** Notification text. The partner's name stays off a locked screen's public version. */
export function ongoingCallText(partnerName: string | null | undefined): { title: string; body: string } {
  const name = (partnerName ?? "").trim();
  return {
    title: name ? `Video call with ${name}` : "Video call",
    body: "Ongoing call · Tap to return to call",
  };
}
