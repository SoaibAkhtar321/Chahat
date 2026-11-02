import React from "react";
import { AppState } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockFetchPage = jest.fn();
const mockSubmitSwipe = jest.fn();
const mockFetchMatches = jest.fn();
const mockFetchIds = jest.fn();
let mockOnChange: () => void = () => {};
let mockOnResync: () => void = () => {};
const mockUnsubscribe = jest.fn();

jest.mock("../mobile/src/context/AuthContext", () => {
  const value = { user: { id: "me" }, isLoggedIn: true }; // one stable object, like the real provider
  return { useAuth: () => value };
});
jest.mock("../mobile/src/services/discovery", () => ({
  fetchDiscoveryPage: (...a: any[]) => mockFetchPage(...a),
  submitSwipe: (...a: any[]) => mockSubmitSwipe(...a),
  undoLastPass: jest.fn(),
}));
jest.mock("../mobile/src/services/chat", () => ({
  fetchUserMatches: (...a: any[]) => mockFetchMatches(...a),
  fetchMatchIds: (...a: any[]) => mockFetchIds(...a),
  subscribeToMyMatches: (_id: string, onChange: () => void, onResync: () => void) => {
    mockOnChange = onChange;
    mockOnResync = onResync;
    return mockUnsubscribe;
  },
}));
jest.mock("../mobile/src/services/subscription", () => ({
  getDailyLikeQuota: () => Promise.resolve({ dailyLimit: 50, likesRemaining: 50 }),
  getUserSubscription: () => Promise.resolve(null),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MiloProvider, useMilo } = require("../mobile/src/context/MiloContext");

const P = (id: string) => ({ id, name: id, age: 25, photos: [], interests: [] });
const M = (id: string, other: string) => ({ id, otherUser: P(other), createdAt: "2026-11-03", unreadCount: 0 });

let ctx: any;
let tree: TestRenderer.ReactTestRenderer | undefined;
let appStateHandler: ((s: string) => void) | undefined;

function Probe() {
  ctx = useMilo();
  return null;
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
async function mount() {
  await act(async () => {
    tree = TestRenderer.create(<MiloProvider><Probe /></MiloProvider>);
  });
  await flush();
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(1_000_000);
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
  mockFetchPage.mockReset().mockResolvedValue({ profiles: [], nextCursor: null });
  mockSubmitSwipe.mockReset();
  mockFetchMatches.mockReset().mockResolvedValue([M("m1", "u1")]);
  mockFetchIds.mockReset().mockResolvedValue(["m1"]);
  mockUnsubscribe.mockReset();
  appStateHandler = undefined;
  jest.spyOn(AppState, "addEventListener").mockImplementation(((_: string, h: any) => {
    appStateHandler = h;
    return { remove: jest.fn() };
  }) as never);
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe("live matches", () => {
  it("existing matches at start are the baseline: no popup", async () => {
    await mount();
    expect(ctx.matches).toHaveLength(1);
    expect(ctx.matchPopup).toBeNull();
  });

  it("the other person's like (realtime event) re-reads the list and opens the popup once", async () => {
    await mount();
    mockFetchMatches.mockResolvedValue([M("m2", "u2"), M("m1", "u1")]);
    await act(async () => mockOnChange());
    await flush();
    expect(ctx.matches.map((m: any) => m.id)).toEqual(["m2", "m1"]);
    expect(ctx.matchPopup).toEqual({ matchId: "m2", otherUserId: "u2" });
    act(() => ctx.dismissMatchPopup());
    expect(ctx.matchPopup).toBeNull();
    // the same match arriving again (second event, focus check) never pops up again
    await act(async () => mockOnChange());
    await flush();
    expect(ctx.matchPopup).toBeNull();
  });

  it("an event for a blocked or removed person produces nothing: the server list does not contain it", async () => {
    await mount();
    // event fires, but the server (RLS / profile lookup) still returns only the old match
    await act(async () => mockOnChange());
    await flush();
    expect(ctx.matchPopup).toBeNull();
    expect(ctx.matches.map((m: any) => m.id)).toEqual(["m1"]);
  });

  it("my own swipe's match is shown by the swipe flow, not by the live path", async () => {
    mockFetchPage.mockResolvedValue({ profiles: [P("u3")], nextCursor: null });
    await mount();
    mockSubmitSwipe.mockResolvedValue({ success: true, isMatch: true, matchId: "m3", likesRemaining: 9 });
    mockFetchMatches.mockResolvedValue([M("m3", "u3"), M("m1", "u1")]);
    let res: any;
    await act(async () => {
      res = await ctx.swipeCard("like");
    });
    await flush();
    expect(res.isMatch).toBe(true);
    expect(ctx.matches.map((m: any) => m.id)).toEqual(["m3", "m1"]); // list updated at once
    expect(ctx.matchPopup).toBeNull(); // no second popup
    expect(ctx.lastMatchedProfile?.id).toBe("u3"); // match screen can still show them
  });

  it("a reconnect catches up on matches missed while offline", async () => {
    await mount();
    mockFetchIds.mockResolvedValue(["m1", "m9"]);
    mockFetchMatches.mockResolvedValue([M("m9", "u9"), M("m1", "u1")]);
    await act(async () => mockOnResync());
    await flush();
    expect(ctx.matchPopup).toEqual({ matchId: "m9", otherUserId: "u9" });
  });

  it("focus check costs only the id query when nothing changed", async () => {
    await mount();
    mockFetchMatches.mockClear();
    mockFetchIds.mockClear();
    await act(async () => ctx.syncMatches());
    expect(mockFetchIds).toHaveBeenCalledTimes(1);
    expect(mockFetchMatches).not.toHaveBeenCalled();
  });

  it("a failed id query is not treated as 'no matches'", async () => {
    await mount();
    mockFetchMatches.mockClear();
    mockFetchIds.mockResolvedValue(null);
    await act(async () => ctx.syncMatches());
    expect(mockFetchMatches).not.toHaveBeenCalled();
    expect(ctx.matches).toHaveLength(1);
  });

  it("a match the list hides (blocked person) does not reload the list on every focus", async () => {
    await mount();
    mockFetchIds.mockResolvedValue(["m1", "hidden"]);
    await act(async () => ctx.syncMatches()); // unknown id -> one full load, list still hides it
    mockFetchMatches.mockClear();
    await act(async () => ctx.syncMatches());
    expect(mockFetchMatches).not.toHaveBeenCalled();
    expect(ctx.matchPopup).toBeNull();
  });

  it("an unmatch (id gone on the server) refreshes the list", async () => {
    await mount();
    mockFetchIds.mockResolvedValue([]);
    mockFetchMatches.mockResolvedValue([]);
    await act(async () => ctx.syncMatches());
    await flush();
    expect(ctx.matches).toEqual([]);
  });

  it("coming back to the foreground catches up on matches", async () => {
    await mount();
    mockFetchIds.mockResolvedValue(["m1", "m5"]);
    mockFetchMatches.mockResolvedValue([M("m5", "u5"), M("m1", "u1")]);
    await act(async () => appStateHandler?.("active"));
    await flush();
    expect(ctx.matchPopup).toEqual({ matchId: "m5", otherUserId: "u5" });
  });

  it("unsubscribes on unmount", async () => {
    await mount();
    await act(async () => tree?.unmount());
    tree = undefined;
    expect(mockUnsubscribe).toHaveBeenCalled();
  });
});

describe("empty deck re-check", () => {
  it("finds a new profile without a restart, without a spinner", async () => {
    await mount();
    expect(ctx.deck).toEqual([]);
    mockFetchPage.mockClear().mockResolvedValue({ profiles: [P("new1")], nextCursor: null });
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + 20_000);
    await act(async () => ctx.recheckDeck());
    await flush();
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    expect(ctx.deck.map((p: any) => p.id)).toEqual(["new1"]);
    expect(ctx.loadingDeck).toBe(false);
  });

  it("backs off: a second look right after the first is skipped; an own tap is not", async () => {
    await mount();
    mockFetchPage.mockClear();
    let now = 1_000_000 + 20_000;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    await act(async () => ctx.recheckDeck()); // empty again -> emptyChecks 1 (needs 30 s now)
    await flush();
    now += 20_000;
    await act(async () => ctx.recheckDeck());
    expect(mockFetchPage).toHaveBeenCalledTimes(1);
    now += 15_000; // 35 s since the last look
    await act(async () => ctx.recheckDeck());
    await flush();
    expect(mockFetchPage).toHaveBeenCalledTimes(2);
    await act(async () => ctx.recheckDeck(true));
    await flush();
    expect(mockFetchPage).toHaveBeenCalledTimes(3);
  });

  it("does nothing while the deck has profiles", async () => {
    mockFetchPage.mockResolvedValue({ profiles: [P("a")], nextCursor: null });
    await mount();
    mockFetchPage.mockClear();
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + 10 * 60_000);
    await act(async () => ctx.recheckDeck(true));
    expect(mockFetchPage).not.toHaveBeenCalled();
  });

  it("the app returning to the foreground looks again when the deck is empty", async () => {
    await mount();
    mockFetchPage.mockClear().mockResolvedValue({ profiles: [P("fg")], nextCursor: null });
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + 20_000);
    await act(async () => appStateHandler?.("active"));
    await flush();
    expect(ctx.deck.map((p: any) => p.id)).toEqual(["fg"]);
  });

  it("uses the same feed call with the current filters (blocks, hidden users, distance rules stay server-side)", async () => {
    await mount();
    mockFetchPage.mockClear();
    jest.spyOn(Date, "now").mockReturnValue(1_000_000 + 20_000);
    await act(async () => ctx.recheckDeck());
    expect(mockFetchPage).toHaveBeenCalledWith(ctx.filters);
  });
});
