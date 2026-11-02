// Pure rules for Phase D (live matches, empty-deck re-check). No React, no network: unit tested.

/** Wait before the next silent look for new profiles while the deck is empty: 15 s, 30 s, 1 min, 2 min, then 5 min. */
export const DECK_RECHECK_DELAYS_MS = [15_000, 30_000, 60_000, 120_000, 300_000] as const;

export function deckRecheckDelayMs(emptyChecks: number): number {
  const i = Math.max(0, Math.min(Math.floor(emptyChecks) || 0, DECK_RECHECK_DELAYS_MS.length - 1));
  return DECK_RECHECK_DELAYS_MS[i]!;
}

export interface RecheckInput {
  deckLength: number;
  /** A deck load or another silent check is already running. */
  busy: boolean;
  now: number;
  /** Time of the last check (0 = never). */
  lastCheckAt: number;
  /** Consecutive checks that found nobody. */
  emptyChecks: number;
  /** A person's own tap (pull to refresh, "Check again"): skips the wait. */
  force?: boolean;
}

/** Only an empty deck is re-checked, never while a load runs, and never faster than the back-off allows. */
export function shouldRecheckDeck(i: RecheckInput): boolean {
  if (i.deckLength > 0 || i.busy) return false;
  if (i.force) return true;
  return i.now - i.lastCheckAt >= deckRecheckDelayMs(i.emptyChecks);
}

/** A match I made myself moments ago is shown by the swipe flow; the live path must not show it twice. */
export const OWN_SWIPE_WINDOW_MS = 20_000;

export function isOwnRecentSwipe(map: Map<string, number>, otherUserId: string, now: number): boolean {
  const at = map.get(otherUserId);
  return at !== undefined && now - at < OWN_SWIPE_WINDOW_MS;
}

/** Match ids the app has not seen before. Never trusts a payload: callers pass ids from a server refetch. */
export function unseenIds(seen: Set<string>, ids: string[]): string[] {
  return ids.filter((id) => !seen.has(id));
}

/**
 * Whether the "It's a match" popup may open now. Not over a call, not over the match screen itself, and not over
 * an open chat (the match still shows in the list and the unread/notification paths).
 */
export function canShowMatchPopup(segments: readonly string[], activeConversation: string | null): boolean {
  const top = segments[0];
  if (top === "call" || top === "calls" || top === "match") return false;
  if (activeConversation) return false;
  return true;
}
