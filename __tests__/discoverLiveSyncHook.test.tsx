import React from "react";
import { AppState } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("expo-router", () => {
  const React = require("react");
  return { useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]) };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useDiscoverLiveSync, EMPTY_DECK_TICK_MS } = require("../mobile/src/hooks/useDiscoverLiveSync");

const recheckDeck = jest.fn().mockResolvedValue(undefined);
const syncMatches = jest.fn().mockResolvedValue(undefined);
let tree: TestRenderer.ReactTestRenderer | undefined;

function Probe({ deckEmpty }: { deckEmpty: boolean }) {
  useDiscoverLiveSync({ deckEmpty, recheckDeck, syncMatches });
  return null;
}
const render = (deckEmpty: boolean) =>
  act(async () => {
    tree = TestRenderer.create(<Probe deckEmpty={deckEmpty} />);
  });

beforeEach(() => {
  jest.useFakeTimers();
  recheckDeck.mockClear();
  syncMatches.mockClear();
  (AppState as any).currentState = "active";
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

describe("Discover live sync hook", () => {
  it("on focus: checks matches (ids) and looks for profiles", async () => {
    await render(false);
    expect(syncMatches).toHaveBeenCalledTimes(1);
    expect(recheckDeck).toHaveBeenCalledTimes(1);
    expect(recheckDeck).toHaveBeenCalledWith(false);
  });

  it("keeps looking on a slow timer only while the deck is empty", async () => {
    await render(true);
    recheckDeck.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(EMPTY_DECK_TICK_MS * 3);
    });
    expect(recheckDeck).toHaveBeenCalledTimes(3);
  });

  it("does not look while the deck has profiles", async () => {
    await render(false);
    recheckDeck.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(EMPTY_DECK_TICK_MS * 4);
    });
    expect(recheckDeck).not.toHaveBeenCalled();
  });

  it("does nothing while the app is in the background", async () => {
    await render(true);
    recheckDeck.mockClear();
    (AppState as any).currentState = "background";
    await act(async () => {
      await jest.advanceTimersByTimeAsync(EMPTY_DECK_TICK_MS * 3);
    });
    expect(recheckDeck).not.toHaveBeenCalled();
  });

  it("stops the timer when the screen loses focus (unmount)", async () => {
    await render(true);
    await act(async () => tree?.unmount());
    tree = undefined;
    recheckDeck.mockClear();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(EMPTY_DECK_TICK_MS * 5);
    });
    expect(recheckDeck).not.toHaveBeenCalled();
  });

  it("a failed look does not stop the timer", async () => {
    await render(true);
    recheckDeck.mockClear().mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(EMPTY_DECK_TICK_MS * 2);
    });
    expect(recheckDeck).toHaveBeenCalledTimes(2);
  });
});
