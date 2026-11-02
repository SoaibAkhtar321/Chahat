import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockPush = jest.fn();
let mockSegments: string[] = ["(tabs)", "discover"];
const mockDismiss = jest.fn();
const mockMilo: any = {};
let mockActive: string | null = null;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useSegments: () => mockSegments,
}));
jest.mock("../mobile/src/context/MiloContext", () => ({ useMilo: () => mockMilo }));
jest.mock("../mobile/src/services/activeConversation", () => ({ getActiveConversation: () => mockActive }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MatchPopupListener } = require("../mobile/src/components/matches/MatchPopupListener");

let tree: TestRenderer.ReactTestRenderer | undefined;
const render = () =>
  act(async () => {
    tree = TestRenderer.create(<MatchPopupListener />);
  });

beforeEach(() => {
  mockPush.mockClear();
  mockDismiss.mockClear();
  mockSegments = ["(tabs)", "discover"];
  mockActive = null;
  Object.assign(mockMilo, { matchPopup: null, dismissMatchPopup: mockDismiss });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});

describe("match popup listener", () => {
  it("does nothing without a pending match", async () => {
    await render();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });

  it("opens the match screen with the real match id, then dismisses", async () => {
    mockMilo.matchPopup = { matchId: "m2", otherUserId: "u2" };
    await render();
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/match/[id]", params: { id: "u2", matchId: "m2" } });
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a call", ["call", "x"], null],
    ["the match screen", ["match", "u2"], null],
    ["an open chat", ["chat", "m1"], "m1"],
  ])("is suppressed over %s but still dismissed (no popup later)", async (_n, segs, active) => {
    mockSegments = segs as string[];
    mockActive = active as string | null;
    mockMilo.matchPopup = { matchId: "m2", otherUserId: "u2" };
    await render();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
