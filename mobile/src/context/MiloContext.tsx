import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import { getActiveConversation } from "../services/activeConversation";
import { AppState } from "react-native";
import type { Profile, MatchItem, Filters, SwipeResponse } from "../types";
import { DEFAULT_FILTERS } from "../types";
import { useAuth } from "./AuthContext";
import {
  fetchDiscoveryPage,
  submitSwipe,
  undoLastPass,
  type DiscoveryCursor,
} from "../services/discovery";
import { fetchUserMatches, fetchMatchIds, subscribeToMyMatches } from "../services/chat";
import { isOwnRecentSwipe, shouldRecheckDeck, unseenIds } from "../services/liveSyncPolicy";
import {
  getDailyLikeQuota,
  getUserSubscription,
  type UserSubscription,
} from "../services/subscription";

interface MiloContextType {
  deck: Profile[];
  currentProfile: Profile | null;
  matches: MatchItem[];
  likesRemaining: number;
  dailyLikeLimit: number | null;
  lastPassedId: string | null;
  filters: Filters;
  loadingDeck: boolean;
  isBoosting: boolean;
  boostTimeRemaining: number;
  totalUnreadCount: number;
  subscription: UserSubscription | null;
  refreshSubscription: () => Promise<void>;
  swipeCard: (direction: "like" | "pass" | "priority") => Promise<SwipeResponse>;
  /** Like or pass one specific profile (opened from a link, chat or Discover), not the top Discover card. */
  swipeProfile: (targetId: string, direction: "like" | "pass") => Promise<SwipeResponse>;
  undoPass: () => Promise<boolean>;
  /** Puts this profile on top of Discover (e.g. opened from a shared link) until it is liked or passed. */
  showInDiscover: (profile: Profile) => void;
  triggerBoost: () => boolean;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  refreshDeck: () => Promise<void>;
  loadMoreDeck: () => Promise<void>;
  refreshMatches: () => Promise<void>;
  /** The messages of this chat have been read: show 0 unread at once (list and tab), then re-sync with the server. */
  clearUnread: (matchId: string) => void;
  /** Silent look for new profiles while the deck is empty (back-off). `force` = a person's own tap. */
  recheckDeck: (force?: boolean) => Promise<void>;
  /** Cheap check for new or removed matches (ids only); loads the full list only when something changed. */
  syncMatches: () => Promise<void>;
  /** A match made by the OTHER person's like: open the "It's a match" popup once, then dismiss. */
  matchPopup: { matchId: string; otherUserId: string } | null;
  dismissMatchPopup: () => void;
  /** Profile just matched through my own swipe: the match screen needs it after the card left the deck. */
  lastMatchedProfile: Profile | null;
}

const MiloContext = createContext<MiloContextType>({
  deck: [],
  currentProfile: null,
  matches: [],
  likesRemaining: 0,
  dailyLikeLimit: null,
  lastPassedId: null,
  filters: DEFAULT_FILTERS,
  loadingDeck: false,
  isBoosting: false,
  boostTimeRemaining: 0,
  totalUnreadCount: 0,
  subscription: null,
  refreshSubscription: async () => {},
  swipeCard: async () => ({ success: false, isMatch: false, likesRemaining: 0 }),
  swipeProfile: async () => ({ success: false, isMatch: false, likesRemaining: 0 }),
  undoPass: async () => false,
  showInDiscover: () => {},
  triggerBoost: () => false,
  setFilters: () => {},
  refreshDeck: async () => {},
  loadMoreDeck: async () => {},
  refreshMatches: async () => {},
  clearUnread: () => {},
  recheckDeck: async () => {},
  syncMatches: async () => {},
  matchPopup: null,
  dismissMatchPopup: () => {},
  lastMatchedProfile: null,
});

export const MiloProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoggedIn } = useAuth();
  const [deck, setDeck] = useState<Profile[]>([]);
  // A profile opened from a shared link stays on top of Discover across deck reloads until it is swiped.
  const pinnedProfile = useRef<Profile | null>(null);
  const withPinned = (list: Profile[]): Profile[] => {
    const pin = pinnedProfile.current;
    return pin ? [pin, ...list.filter((p) => p.id !== pin.id)] : list;
  };
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [likesRemaining, setLikesRemaining] = useState<number>(0);
  const [dailyLikeLimit, setDailyLikeLimit] = useState<number | null>(null);
  const [lastPassedId, setLastPassedId] = useState<string | null>(null);
  const [lastPassedProfile, setLastPassedProfile] = useState<Profile | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [loadingDeck, setLoadingDeck] = useState<boolean>(false);
  const [nextCursor, setNextCursor] = useState<DiscoveryCursor | null>(null);
  const loadingMoreRef = useRef(false);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const activeUserId = useRef<string | null>(user?.id ?? null);
  const deckRequest = useRef(0);
  const matchesRequest = useRef(0);
  const subscriptionRequest = useRef(0);
  const currentUserId = user?.id ?? null;
  const [matchPopup, setMatchPopup] = useState<{ matchId: string; otherUserId: string } | null>(null);
  const [lastMatchedProfile, setLastMatchedProfile] = useState<Profile | null>(null);
  // Live-sync bookkeeping (refs: no re-render needed).
  const deckRef = useRef<Profile[]>(deck);
  deckRef.current = deck;
  const matchesRef = useRef<MatchItem[]>(matches);
  matchesRef.current = matches;
  const loadingDeckRef = useRef(false);
  loadingDeckRef.current = loadingDeck;
  const recheckBusy = useRef(false);
  const emptyChecks = useRef(0);
  const lastCheckAt = useRef(0);
  const seenMatchIds = useRef<Set<string>>(new Set());
  const matchBaselineReady = useRef(false);
  const ownSwipeAt = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (activeUserId.current === currentUserId) return;
    activeUserId.current = currentUserId;
    deckRequest.current += 1;
    matchesRequest.current += 1;
    subscriptionRequest.current += 1;
    pinnedProfile.current = null;
    setDeck([]);
    setMatches([]);
    setLikesRemaining(0);
    setDailyLikeLimit(null);
    setLastPassedId(null);
    setLastPassedProfile(null);
    setFilters(DEFAULT_FILTERS);
    setLoadingDeck(false);
    setNextCursor(null);
    loadingMoreRef.current = false;
    setSubscription(null);
    setMatchPopup(null);
    setLastMatchedProfile(null);
    emptyChecks.current = 0;
    lastCheckAt.current = 0;
    recheckBusy.current = false;
    seenMatchIds.current = new Set();
    matchBaselineReady.current = false;
    ownSwipeAt.current = new Map();
  }, [currentUserId]);

  const refreshSubscription = useCallback(async () => {
    const request = ++subscriptionRequest.current;
    try {
      const result = await getUserSubscription();
      if (subscriptionRequest.current === request && activeUserId.current === user?.id) {
        setSubscription(result);
        // The like allowance depends on the plan (paid = unlimited), so re-read it whenever the plan is re-read.
        try {
          const quota = await getDailyLikeQuota();
          if (subscriptionRequest.current === request && activeUserId.current === user?.id) {
            setDailyLikeLimit(quota.dailyLimit);
            setLikesRemaining(quota.likesRemaining);
          }
        } catch (quotaError) {
          console.warn("Could not refresh like quota:", quotaError);
        }
      }
    } catch (error) {
      if (subscriptionRequest.current === request && activeUserId.current === user?.id) {
        console.warn("Could not verify subscription state:", error);
        setSubscription(null);
      }
    }
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      setDailyLikeLimit(null);
      setLikesRemaining(0);
      return () => {
        active = false;
      };
    }
    setDailyLikeLimit(null);
    setLikesRemaining(0);
    getDailyLikeQuota()
      .then((quota) => {
        if (!active) return;
        setDailyLikeLimit(quota.dailyLimit);
        setLikesRemaining(quota.likesRemaining);
      })
      .catch((error) => {
        if (active) console.warn("Could not load authoritative like quota:", error);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const refreshDeck = useCallback(async () => {
    if (!user) return;
    const request = ++deckRequest.current;
    const requestedUserId = user.id;
    // A full load (start, filters, pull to refresh, "Refresh") restarts the back-off of the silent re-check.
    emptyChecks.current = 0;
    lastCheckAt.current = Date.now();
    setLoadingDeck(true);
    try {
      const page = await fetchDiscoveryPage(filters);
      if (deckRequest.current === request && activeUserId.current === requestedUserId) {
        setDeck(withPinned(page.profiles));
        setNextCursor(page.nextCursor);
      }
    } finally {
      if (deckRequest.current === request && activeUserId.current === requestedUserId) {
        setLoadingDeck(false);
      }
    }
  }, [user, filters]);

  const loadMoreDeck = useCallback(async () => {
    if (!user || !nextCursor || loadingMoreRef.current) return;
    const request = deckRequest.current;
    const requestedUserId = user.id;
    loadingMoreRef.current = true;
    try {
      const page = await fetchDiscoveryPage(filters, nextCursor);
      if (deckRequest.current !== request || activeUserId.current !== requestedUserId) return;
      setDeck((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.profiles.filter((item) => !existing.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [user, nextCursor, filters]);

  // Silent re-check of an EMPTY deck (screen focus, app foreground, timer on the empty Discover screen). No spinner,
  // never while a load runs, and spaced by the back-off (15 s ... 5 min) so an idle empty screen costs almost nothing.
  // Uses the same feed call as a normal load, so filters, blocks, hidden users and the city/distance rules all apply.
  const recheckDeck = useCallback(
    async (force = false) => {
      if (!user) return;
      const now = Date.now();
      if (
        !shouldRecheckDeck({
          deckLength: deckRef.current.length,
          busy: loadingDeckRef.current || recheckBusy.current,
          now,
          lastCheckAt: lastCheckAt.current,
          emptyChecks: emptyChecks.current,
          force,
        })
      ) {
        return;
      }
      recheckBusy.current = true;
      lastCheckAt.current = now;
      const request = ++deckRequest.current;
      const requestedUserId = user.id;
      try {
        const page = await fetchDiscoveryPage(filters);
        if (deckRequest.current !== request || activeUserId.current !== requestedUserId) return;
        if (page.profiles.length > 0) {
          emptyChecks.current = 0;
          setDeck(withPinned(page.profiles));
          setNextCursor(page.nextCursor);
        } else {
          emptyChecks.current += 1;
        }
      } finally {
        recheckBusy.current = false;
      }
    },
    [user, filters],
  );

  // Many events ask for a refresh at once (send, receive, delete, react, call ended...). Coalesce them: while a
  // load is running, further calls only mark that one more load is needed, so a burst costs at most two loads.
  const matchesLoading = useRef<Promise<void> | null>(null);
  const matchesAgain = useRef(false);
  const refreshMatches = useCallback(async () => {
    if (!user) return;
    if (matchesLoading.current) {
      matchesAgain.current = true;
      return matchesLoading.current;
    }
    const run = async () => {
      do {
        matchesAgain.current = false;
        const request = ++matchesRequest.current;
        const requestedUserId = user.id;
        const items = await fetchUserMatches(user.id);
        if (matchesRequest.current === request && activeUserId.current === requestedUserId) {
          // The chat on screen is being read: never show it as unread, even if this load raced the mark-read.
          const open = getActiveConversation();
          setMatches(open ? items.map((m) => (m.id.toLowerCase() === open && m.unreadCount ? { ...m, unreadCount: 0 } : m)) : items);
          // A match that is new to this device and was not made by my own swipe: open the popup (once). The list comes
          // from the server (RLS and the profile lookup hide blocked and removed matches), so those never show up here.
          const fresh = items.filter((m) => unseenIds(seenMatchIds.current, [m.id]).length > 0);
          items.forEach((m) => seenMatchIds.current.add(m.id));
          if (matchBaselineReady.current) {
            const other = fresh.find((m) => !isOwnRecentSwipe(ownSwipeAt.current, m.otherUser.id, Date.now()));
            if (other) setMatchPopup({ matchId: other.id, otherUserId: other.otherUser.id });
          }
        }
      } while (matchesAgain.current);
    };
    matchesLoading.current = run().finally(() => {
      matchesLoading.current = null;
    });
    return matchesLoading.current;
  }, [user]);

  // Ids only. First call after login sets the baseline (matches that already existed are not "new"); later calls
  // load the full list only when an id appeared or disappeared, so focusing a screen costs one small query.
  const syncMatches = useCallback(async () => {
    if (!user) return;
    const requestedUserId = user.id;
    const ids = await fetchMatchIds(user.id);
    if (!ids || activeUserId.current !== requestedUserId) return;
    if (!matchBaselineReady.current) {
      ids.forEach((id) => seenMatchIds.current.add(id));
      matchBaselineReady.current = true;
      return;
    }
    const serverIds = new Set(ids);
    const removed = matchesRef.current.some((m) => !serverIds.has(m.id));
    if (unseenIds(seenMatchIds.current, ids).length === 0 && !removed) return;
    await refreshMatches();
    // Matches the list hides (e.g. a blocked person) are known now too, so they do not trigger a reload every time.
    if (activeUserId.current === requestedUserId) ids.forEach((id) => seenMatchIds.current.add(id));
  }, [user, refreshMatches]);

  const recheckDeckRef = useRef(recheckDeck);
  recheckDeckRef.current = recheckDeck;
  const dismissMatchPopup = useCallback(() => setMatchPopup(null), []);

  // Live matches: the other person's like creates the row; this device only re-reads the list from the server.
  const refreshMatchesRef = useRef(refreshMatches);
  refreshMatchesRef.current = refreshMatches;
  const syncMatchesRef = useRef(syncMatches);
  syncMatchesRef.current = syncMatches;
  useEffect(() => {
    if (!user?.id) return;
    return subscribeToMyMatches(
      user.id,
      () => void refreshMatchesRef.current(),
      () => void syncMatchesRef.current(),
    );
  }, [user?.id]);

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  // Keep the plan in sync with the server: a renewal, expiry or refund that happened while the app was in the
  // background is picked up as soon as the person comes back.
  useEffect(() => {
    if (!user?.id) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void refreshSubscription();
        // Back from the background: catch up on matches made meanwhile and look again if the deck is empty.
        void syncMatchesRef.current();
        void recheckDeckRef.current();
      }
    });
    return () => sub.remove();
  }, [user?.id, refreshSubscription]);

  useEffect(() => {
    if (isLoggedIn && user) {
      refreshDeck();
      refreshMatches();
      void syncMatches();
    } else {
      setDeck([]);
      setMatches([]);
    }
  }, [isLoggedIn, user, refreshDeck, refreshMatches, syncMatches]);

  const swipeCard = async (direction: "like" | "pass" | "priority"): Promise<SwipeResponse> => {
    if (!user || deck.length === 0) {
      return { success: false, isMatch: false, likesRemaining };
    }

    const target = deck[0]!;
    if (pinnedProfile.current?.id === target.id) pinnedProfile.current = null;
    const remainingDeck = deck.slice(1);
    setDeck(remainingDeck);

    if (direction === "pass") {
      setLastPassedId(target.id);
      setLastPassedProfile(target);
    }

    const requestedUserId = user.id;
    ownSwipeAt.current.set(target.id, Date.now());
    const res = await submitSwipe(target.id, direction, user.id);
    // Only a swipe that made a match may hide the live popup; otherwise the other person's later like must still show it.
    if (!res.isMatch) ownSwipeAt.current.delete(target.id);
    if (activeUserId.current !== requestedUserId) return res;
    if (remainingDeck.length < 5) void loadMoreDeck();
    if (res.likesRemaining !== undefined) {
      setLikesRemaining(res.likesRemaining);
    }

    if (res.isMatch) {
      setLastMatchedProfile(target);
      refreshMatches();
    }

    return res;
  };

  const swipeProfile = async (targetId: string, direction: "like" | "pass"): Promise<SwipeResponse> => {
    if (!user) return { success: false, isMatch: false, likesRemaining };
    const requestedUserId = user.id;
    ownSwipeAt.current.set(targetId, Date.now());
    const matchedFromDeck = deck.find((p) => p.id === targetId) ?? null;
    const res = await submitSwipe(targetId, direction, user.id);
    if (!res.isMatch) ownSwipeAt.current.delete(targetId);
    if (activeUserId.current !== requestedUserId) return res;
    if (res.success) {
      if (pinnedProfile.current?.id === targetId) pinnedProfile.current = null;
      setDeck((prev) => prev.filter((p) => p.id !== targetId));
    }
    if (res.likesRemaining !== undefined && res.success) setLikesRemaining(res.likesRemaining);
    if (res.isMatch) {
      if (matchedFromDeck) setLastMatchedProfile(matchedFromDeck);
      refreshMatches();
    }
    return res;
  };

  const undoPass = async (): Promise<boolean> => {
    if (!lastPassedId || !lastPassedProfile) return false;
    const requestedUserId = user?.id;
    if (!requestedUserId) return false;
    const ok = await undoLastPass(lastPassedId);
    if (activeUserId.current !== requestedUserId) return false;
    if (ok) {
      setDeck([lastPassedProfile, ...deck]);
      setLastPassedId(null);
      setLastPassedProfile(null);
      return true;
    }
    return false;
  };

  const showInDiscover = useCallback((profile: Profile) => {
    pinnedProfile.current = profile;
    setDeck((prev) => [profile, ...prev.filter((p) => p.id !== profile.id)]);
  }, []);

  const triggerBoost = () => false;
  const isBoosting = false;
  const boostTimeRemaining = 0;
  const clearUnread = useCallback(
    (matchId: string) => {
      setMatches((prev) =>
        prev.some((m) => m.id === matchId && m.unreadCount > 0)
          ? prev.map((m) => (m.id === matchId ? { ...m, unreadCount: 0 } : m))
          : prev,
      );
      void refreshMatches(); // coalesced; also syncs with a load that started before the mark
    },
    [refreshMatches],
  );
  const totalUnreadCount = matches.reduce((acc, m) => acc + (m.unreadCount || 0), 0);
  const currentProfile = deck[0] || null;

  return (
    <MiloContext.Provider
      value={{
        deck,
        currentProfile,
        matches,
        likesRemaining,
        dailyLikeLimit,
        lastPassedId,
        filters,
        loadingDeck,
        isBoosting,
        boostTimeRemaining,
        totalUnreadCount,
        subscription,
        refreshSubscription,
        swipeCard,
        swipeProfile,
        undoPass,
        showInDiscover,
        triggerBoost,
        setFilters,
        refreshDeck,
        loadMoreDeck,
        refreshMatches,
        clearUnread,
        recheckDeck,
        syncMatches,
        matchPopup,
        dismissMatchPopup,
        lastMatchedProfile,
      }}
    >
      {children}
    </MiloContext.Provider>
  );
};

export const useMilo = () => useContext(MiloContext);
