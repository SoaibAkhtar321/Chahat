import { useEffect, useRef } from "react";
import { Alert } from "../../utils/alert";
import * as Notifications from "expo-notifications";
import { usePathname, useRootNavigationState, useRouter } from "expo-router";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../services/supabase";
import { resolveNotificationDestination } from "../../services/notificationPolicy";
import { checkLikesAccessRaw } from "../../services/likes";
import { resolveLikeTapRoute } from "../../services/likesPolicy";
import { isValidUUID } from "../../utils/validation";
import { useIncomingCallController } from "../../context/IncomingCallContext";
import { buildExistingCallRoute, getMyVideoCalls } from "../../services/calls";
import { dismissOngoingCallNotification } from "../../services/ongoingCallNotification";
import { isOnCallScreen, parseOngoingCallData } from "../../services/ongoingCallPolicy";

export function NotificationResponseHandler() {
  const router = useRouter();
  // A cold-start tap can arrive before the root navigator has mounted; navigating then throws.
  const navigationReady = Boolean(useRootNavigationState()?.key);
  const { user } = useAuth();
  const handled = useRef(new Set<string>());
  // "Tap to return to call": the app may already be on the call screen (it was only shrunk into the floating
  // window), in which case the tap must not open a second copy of it.
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const lastOngoingTap = useRef(0);
  const callController = useIncomingCallController();

  useEffect(() => {
    if (!user || !navigationReady) return;
    let active = true;

    const openDestination = async (response: Notifications.NotificationResponse) => {
      const ongoing = parseOngoingCallData(response.notification.request.content.data);
      if (ongoing) {
        // The notification id never changes, so it cannot be de-duplicated by id: ignore a repeat within 3 s
        // (a cold start delivers the same tap twice) and otherwise act on every tap.
        const tappedAt = Date.now();
        if (tappedAt - lastOngoingTap.current < 3000) return;
        lastOngoingTap.current = tappedAt;
        if (isOnCallScreen(pathnameRef.current)) return;
        try {
          const call = (await getMyVideoCalls()).find((item) => item.id === ongoing.callId);
          if (!active) return;
          if (!call || call.status !== "accepted") {
            // The call is over (for example the app was restarted): remove the stale notification.
            await dismissOngoingCallNotification();
            return;
          }
          router.push(buildExistingCallRoute({ id: call.id, match_id: call.match_id, call_type: call.call_type }));
        } catch {
          // Could not check (offline): open the call screen anyway, it shows the real state.
          if (active) router.push(buildExistingCallRoute({ id: ongoing.callId, match_id: ongoing.matchId, call_type: "video" }));
        }
        return;
      }
      const identifier = response.notification.request.identifier;
      if (handled.current.has(identifier)) return;
      handled.current.add(identifier);

      const data = response.notification.request.content.data;
      if (!data || typeof data !== "object") return;
      const category = data.category;
      const matchId = data.matchId;
      if (category === "call") {
        // Incoming call: Answer / Decline / tap. The controller asks the server about the call (it never
        // trusts this payload) and is started here too, because a cold-start response can reach this
        // effect before the provider's own effect has run. start() is a no-op for the same account.
        if (!callController) return;
        await callController.start(user.id);
        if (!active) return;
        await callController.handleNotificationResponse({
          actionIdentifier: response.actionIdentifier,
          data,
        });
        return;
      }
      if (category === "like") {
        // Phase 2: never trust the push payload or a cached tier; ask the server on every tap.
        const route = await resolveLikeTapRoute(checkLikesAccessRaw);
        if (!active) return;
        if (route.kind === "likes") router.push("/(tabs)/likes");
        else if (route.kind === "premium") router.push("/premium");
        else Alert.alert("Couldn't open likes", route.message);
        return;
      }
      if ((category === "match" || category === "message") && typeof matchId === "string" && isValidUUID(matchId)) {
        const { data: match, error } = await supabase
          .from("matches")
          .select("id, user_a, user_b")
          .eq("id", matchId)
          .maybeSingle();
        if (!active) return;
        if (error) {
          console.warn("Could not validate notification destination:", error.message);
          Alert.alert("Conversation unavailable", "Please try opening this conversation again.");
          return;
        }
        const destination = resolveNotificationDestination(category, matchId, user.id, match);
        if (destination?.kind === "chat") {
          router.push({ pathname: "/chat/[id]", params: { id: destination.matchId } });
        } else {
          Alert.alert("Conversation unavailable", "This conversation is no longer available.");
        }
      }
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void openDestination(response);
    });
    Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (active && response) await openDestination(response);
        await Notifications.clearLastNotificationResponseAsync();
      })
      .catch((error) => console.warn("Could not read notification launch response:", error));

    return () => {
      active = false;
      subscription.remove();
    };
  }, [router, user, navigationReady, callController]);

  return null;
}
