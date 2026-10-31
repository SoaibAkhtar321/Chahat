// Android side effects for the ongoing-call notification. Pure rules live in ongoingCallPolicy.ts.
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  ONGOING_CALL_CATEGORY,
  ONGOING_CALL_CHANNEL_ID,
  ONGOING_CALL_NOTIFICATION_ID,
  ongoingCallText,
} from "./ongoingCallPolicy";

/**
 * Shows (or refreshes) the persistent "Tap to return to call" notification. Silent, cannot be swiped away
 * while the call lasts. Best effort: with notifications turned off in system settings nothing is shown and
 * nothing else changes. Never throws.
 */
export async function showOngoingCallNotification(input: {
  callId: string;
  matchId: string;
  partnerName?: string | null;
}): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(ONGOING_CALL_CHANNEL_ID, {
      name: "Ongoing call",
      description: "Shows while you are on a video call so you can jump back to it.",
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    const text = ongoingCallText(input.partnerName);
    await Notifications.scheduleNotificationAsync({
      identifier: ONGOING_CALL_NOTIFICATION_ID,
      content: {
        title: text.title,
        body: text.body,
        sticky: true,
        autoDismiss: false,
        data: { category: ONGOING_CALL_CATEGORY, callId: input.callId, matchId: input.matchId },
      },
      trigger: { channelId: ONGOING_CALL_CHANNEL_ID },
    });
  } catch {
    // Notification permission denied or module unavailable: the call itself is unaffected.
  }
}

/** Removes the ongoing-call notification (call ended, screen closed, or a stale one after the app restarted). */
export async function dismissOngoingCallNotification(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.dismissNotificationAsync(ONGOING_CALL_NOTIFICATION_ID);
  } catch {
    // Already gone.
  }
}
