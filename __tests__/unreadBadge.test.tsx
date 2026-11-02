// Phase C: a message I have seen must not keep its "1 new message" badge.
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const MATCH = "33333333-3333-4333-8333-333333333333";
const OTHER_MATCH = "55555555-5555-4555-8555-555555555555";
const mockUser = { id: "11111111-1111-4111-8111-111111111111" };
const mockFetchMatches = jest.fn();
const mockRpc = jest.fn();

jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }), { virtual: true });
jest.mock("../mobile/src/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser, isLoggedIn: true }) }));
jest.mock("../mobile/src/services/discovery", () => ({
  fetchDiscoveryPage: jest.fn(async () => ({ profiles: [], nextCursor: null })),
  submitSwipe: jest.fn(),
  undoLastPass: jest.fn(),
  DEMO_PROFILES: [],
}));
jest.mock("../mobile/src/services/subscription", () => ({
  getDailyLikeQuota: jest.fn(async () => ({ remaining: 0, limit: 10 })),
  getUserSubscription: jest.fn(async () => null),
}));
jest.mock("../mobile/src/services/chat", () => ({ fetchUserMatches: (...a: unknown[]) => mockFetchMatches(...a) }));

import { MiloProvider, useMilo } from "../mobile/src/context/MiloContext";
import { clearActiveConversation, setActiveConversation } from "../mobile/src/services/activeConversation";

const item = (id: string, unreadCount: number) => ({ id, otherUser: { id: "x" }, createdAt: "2026-11-01T00:00:00Z", unreadCount });

let ctx: ReturnType<typeof useMilo>;
const Probe = () => {
  ctx = useMilo();
  return null;
};
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

async function mount() {
  await act(async () => {
    TestRenderer.create(
      <MiloProvider>
        <Probe />
      </MiloProvider>,
    );
  });
  await flush();
}

beforeEach(() => {
  jest.clearAllMocks();
  clearActiveConversation(MATCH);
  mockFetchMatches.mockResolvedValue([item(MATCH, 1), item(OTHER_MATCH, 2)]);
});

describe("clearUnread", () => {
  it("sets that chat to 0 at once, keeps the others, and the tab total follows", async () => {
    await mount();
    expect(ctx.totalUnreadCount).toBe(3);

    // The server now agrees the chat is read.
    mockFetchMatches.mockResolvedValue([item(MATCH, 0), item(OTHER_MATCH, 2)]);
    act(() => ctx.clearUnread(MATCH));
    expect(ctx.matches.find((m) => m.id === MATCH)!.unreadCount).toBe(0);
    expect(ctx.matches.find((m) => m.id === OTHER_MATCH)!.unreadCount).toBe(2);
    expect(ctx.totalUnreadCount).toBe(2);
    await flush();
    expect(ctx.totalUnreadCount).toBe(2);
  });

  it("re-syncs with the server afterwards (one coalesced refresh)", async () => {
    await mount();
    mockFetchMatches.mockClear();
    act(() => {
      ctx.clearUnread(MATCH);
      ctx.clearUnread(MATCH);
    });
    await flush();
    expect(mockFetchMatches.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("is a no-op for an unknown chat", async () => {
    await mount();
    act(() => ctx.clearUnread("66666666-6666-4666-8666-666666666666"));
    expect(ctx.totalUnreadCount).toBe(3);
  });
});

describe("the chat on screen never shows as unread", () => {
  it("a refresh that raced the mark-read keeps the open chat at 0", async () => {
    setActiveConversation(MATCH);
    await mount(); // server still says 1 (mark-read not landed yet)
    expect(ctx.matches.find((m) => m.id === MATCH)!.unreadCount).toBe(0);
    expect(ctx.matches.find((m) => m.id === OTHER_MATCH)!.unreadCount).toBe(2);
  });

  it("after leaving the chat the server count is authoritative again", async () => {
    setActiveConversation(MATCH);
    await mount();
    clearActiveConversation(MATCH);
    await act(async () => { await ctx.refreshMatches(); });
    expect(ctx.matches.find((m) => m.id === MATCH)!.unreadCount).toBe(1);
  });
});
