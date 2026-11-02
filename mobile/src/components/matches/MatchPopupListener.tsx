import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { useMilo } from "../../context/MiloContext";
import { getActiveConversation } from "../../services/activeConversation";
import { canShowMatchPopup } from "../../services/liveSyncPolicy";

/**
 * Opens the existing "It's a match" screen when the OTHER person's like completed a match (the swiper's own match is
 * shown by the swipe flow). Renders nothing. Suppressed over a call, an open chat or the match screen itself; the match
 * is in the Chats list either way.
 */
export function MatchPopupListener() {
  const router = useRouter();
  const segments = useSegments() as string[];
  const { matchPopup, dismissMatchPopup } = useMilo();

  useEffect(() => {
    if (!matchPopup) return;
    const show = canShowMatchPopup(segments, getActiveConversation());
    dismissMatchPopup(); // one popup per match, whether it opened or was suppressed
    if (!show) return;
    router.push({ pathname: "/match/[id]", params: { id: matchPopup.otherUserId, matchId: matchPopup.matchId } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchPopup]);

  return null;
}
