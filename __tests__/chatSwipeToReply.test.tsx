import React from "react";
import { PanResponder, Vibration } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/services/voiceMedia", () => ({
  getAudioPlayerAdapter: () => ({ playAsync: jest.fn(), stopAsync: jest.fn(async () => undefined), pauseAsync: jest.fn(async () => undefined) }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ChatBubble } = require("../mobile/src/components/chat/ChatBubble");

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  matchId: "f6c60000-0000-4000-8000-000000000001",
  sender: "bbbbbbbb-0000-4000-8000-000000000002",
  from: "them" as const,
  text: "what are you doing tonight?",
  at: Date.now(),
  status: "sent" as const,
  messageType: "text" as const,
};

type PanConfig = Parameters<typeof PanResponder.create>[0];
let configs: PanConfig[] = [];
let createSpy: jest.SpyInstance;
let vibrateSpy: jest.SpyInstance;

const gs = (dx: number, dy = 0) => ({ dx, dy }) as any;

function render(props: Record<string, unknown>) {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<ChatBubble {...(props as any)} />);
  });
  return r;
}
/** The pan config of the (single) swipe wrapper in the last render. */
const pan = () => configs[configs.length - 1]!;
const swipe = (config: PanConfig, dxs: number[], dy = 0) => {
  act(() => {
    config.onPanResponderGrant?.({} as any, gs(0));
    dxs.forEach((dx) => config.onPanResponderMove?.({} as any, gs(dx, dy)));
  });
};
const release = (config: PanConfig, dx: number) =>
  act(() => {
    config.onPanResponderRelease?.({} as any, gs(dx));
  });

beforeEach(() => {
  configs = [];
  const real = PanResponder.create.bind(PanResponder);
  createSpy = jest.spyOn(PanResponder, "create").mockImplementation((c: PanConfig) => {
    configs.push(c);
    return real(c);
  });
  vibrateSpy = jest.spyOn(Vibration, "vibrate").mockImplementation(() => undefined);
});
afterEach(() => {
  createSpy.mockRestore();
  vibrateSpy.mockRestore();
});

describe("swipe a message to reply", () => {
  it("a clear rightward swipe past the trigger sets the reply for THAT message", () => {
    const onSwipeReply = jest.fn();
    const message = { ...base };
    render({ message, onSwipeReply });
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(30, 3))).toBe(true);
    swipe(pan(), [20, 45, 70]);
    release(pan(), 70);
    expect(onSwipeReply).toHaveBeenCalledTimes(1);
    expect(onSwipeReply).toHaveBeenCalledWith(message);
  });

  it("releasing before the trigger distance does nothing", () => {
    const onSwipeReply = jest.fn();
    render({ message: base, onSwipeReply });
    swipe(pan(), [10, 30, 40]);
    release(pan(), 40);
    expect(onSwipeReply).not.toHaveBeenCalled();
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it("a cancelled gesture (the system took the touch) sets no reply", () => {
    const onSwipeReply = jest.fn();
    render({ message: base, onSwipeReply });
    swipe(pan(), [30, 70]);
    act(() => pan().onPanResponderTerminate?.({} as any, gs(70)));
    expect(onSwipeReply).not.toHaveBeenCalled();
  });

  it("gives ONE light haptic tap when the trigger distance is crossed, not on every move", () => {
    render({ message: base, onSwipeReply: jest.fn() });
    swipe(pan(), [10, 30, 50]);
    expect(vibrateSpy).not.toHaveBeenCalled();
    swipe(pan(), [60, 65, 70, 75]);
    expect(vibrateSpy).toHaveBeenCalledTimes(1);
  });

  it("does not take over vertical scrolling or diagonal drags", () => {
    render({ message: base, onSwipeReply: jest.fn() });
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(3, 40))).toBe(false);
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(30, 25))).toBe(false);
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(-40, 2))).toBe(false);
    // A plain touch (tap, start of a long-press) must stay with the bubble.
    expect(pan().onStartShouldSetPanResponder?.({} as any, gs(0))).toBe(false);
  });

  it("the long-press menu is still wired on the same bubble", () => {
    const onLongPress = jest.fn();
    const r = render({ message: base, onSwipeReply: jest.fn(), onLongPress });
    const bubble = r.root.findAll((n) => n.props?.testID === `message-bubble-${base.id}` && typeof n.props.onLongPress === "function")[0]!;
    act(() => bubble.props.onLongPress());
    expect(onLongPress).toHaveBeenCalledWith(base);
  });

  it("my own messages, voice bubbles and image bubbles can all be swiped", () => {
    const cases = [
      { ...base, from: "me" as const },
      { ...base, messageType: "voice" as const, audio: "https://signed/a.m4a", audioDurationSec: 12, text: "" },
      { ...base, messageType: "image" as const, image: "https://signed/i.jpg", text: "" },
    ];
    for (const message of cases) {
      const onSwipeReply = jest.fn();
      render({ message, onSwipeReply });
      expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(30, 2))).toBe(true);
      swipe(pan(), [70]);
      release(pan(), 70);
      expect(onSwipeReply).toHaveBeenCalledWith(message);
    }
  });

  it("a message deleted for everyone is not swipeable", () => {
    const onSwipeReply = jest.fn();
    render({ message: { ...base, text: "", deletedAt: "2026-10-20T01:00:00Z" }, onSwipeReply });
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(30, 2))).toBe(false);
    swipe(pan(), [70]);
    release(pan(), 70);
    expect(onSwipeReply).not.toHaveBeenCalled();
  });

  it("a failed message is not swipeable (same rule as the Reply menu item)", () => {
    const onSwipeReply = jest.fn();
    render({ message: { ...base, from: "me" as const, status: "failed" as const }, onSwipeReply });
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(30, 2))).toBe(false);
    release(pan(), 70);
    expect(onSwipeReply).not.toHaveBeenCalled();
  });

  it("without an onSwipeReply handler the bubble is not swipeable", () => {
    render({ message: base });
    expect(pan().onMoveShouldSetPanResponder?.({} as any, gs(30, 2))).toBe(false);
  });

  it("call-history lines are plain centered rows with no swipe at all", () => {
    createSpy.mockClear();
    const r = render({
      message: { ...base, messageType: "system" as const, text: "call|video|missed|abc|0" },
      onSwipeReply: jest.fn(),
    });
    expect(r.root.findAll((n) => String(n.props?.testID ?? "").startsWith("message-swipe-")).length).toBe(0);
    // The voice-seek responder is created by every bubble (it uses the capture phase); no swipe responder may exist.
    expect(configs.filter((c) => !c.onMoveShouldSetPanResponderCapture)).toHaveLength(0);
  });

  it("once a swipe has started the list may not take the touch away", () => {
    render({ message: base, onSwipeReply: jest.fn() });
    expect(pan().onPanResponderTerminationRequest?.({} as any, gs(30))).toBe(false);
  });
});
