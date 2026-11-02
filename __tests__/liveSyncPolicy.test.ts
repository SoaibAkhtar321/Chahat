import {
  DECK_RECHECK_DELAYS_MS,
  OWN_SWIPE_WINDOW_MS,
  canShowMatchPopup,
  deckRecheckDelayMs,
  isOwnRecentSwipe,
  shouldRecheckDeck,
  unseenIds,
} from "../mobile/src/services/liveSyncPolicy";

describe("deck re-check back-off", () => {
  it("grows 15s, 30s, 1m, 2m, 5m and stays at 5 minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(deckRecheckDelayMs)).toEqual([15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
    expect(deckRecheckDelayMs(-3)).toBe(DECK_RECHECK_DELAYS_MS[0]);
    expect(deckRecheckDelayMs(NaN)).toBe(DECK_RECHECK_DELAYS_MS[0]);
  });

  const base = { deckLength: 0, busy: false, now: 1_000_000, lastCheckAt: 1_000_000 - 20_000, emptyChecks: 0 };

  it("never looks when the deck has profiles or a load is running", () => {
    expect(shouldRecheckDeck({ ...base, deckLength: 1 })).toBe(false);
    expect(shouldRecheckDeck({ ...base, busy: true })).toBe(false);
    expect(shouldRecheckDeck({ ...base, deckLength: 3, force: true })).toBe(false);
  });

  it("waits for the back-off, but a person's own tap skips the wait", () => {
    expect(shouldRecheckDeck(base)).toBe(true); // 20 s >= 15 s
    expect(shouldRecheckDeck({ ...base, lastCheckAt: base.now - 5_000 })).toBe(false);
    expect(shouldRecheckDeck({ ...base, lastCheckAt: base.now - 5_000, force: true })).toBe(true);
    expect(shouldRecheckDeck({ ...base, emptyChecks: 4, lastCheckAt: base.now - 200_000 })).toBe(false);
    expect(shouldRecheckDeck({ ...base, emptyChecks: 4, lastCheckAt: base.now - 300_000 })).toBe(true);
  });
});

describe("own swipes and unseen ids", () => {
  it("a match from my own swipe is only own inside the window", () => {
    const m = new Map([["u1", 1000]]);
    expect(isOwnRecentSwipe(m, "u1", 1000 + OWN_SWIPE_WINDOW_MS - 1)).toBe(true);
    expect(isOwnRecentSwipe(m, "u1", 1000 + OWN_SWIPE_WINDOW_MS)).toBe(false);
    expect(isOwnRecentSwipe(m, "u2", 1500)).toBe(false);
  });
  it("unseenIds returns only ids not seen yet", () => {
    expect(unseenIds(new Set(["a"]), ["a", "b", "c"])).toEqual(["b", "c"]);
    expect(unseenIds(new Set(), [])).toEqual([]);
  });
});

describe("match popup placement", () => {
  it("opens over the tabs, never over a call, the match screen or an open chat", () => {
    expect(canShowMatchPopup(["(tabs)", "discover"], null)).toBe(true);
    expect(canShowMatchPopup([], null)).toBe(true);
    expect(canShowMatchPopup(["call", "abc"], null)).toBe(false);
    expect(canShowMatchPopup(["calls"], null)).toBe(false);
    expect(canShowMatchPopup(["match", "x"], null)).toBe(false);
    expect(canShowMatchPopup(["chat", "abc"], "abc")).toBe(false);
  });
});
