// Phase B: ChatBubble voice playback: live notes play on the first tap, errors are shown, recording blocks play, seek works.
import React from "react";
import { Alert, PanResponder, Text, TouchableOpacity } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockPlay = jest.fn();
const mockPause = jest.fn(async () => undefined);
const mockStop = jest.fn(async () => undefined);
const mockSeek = jest.fn(async () => undefined);

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
  getAudioPlayerAdapter: () => ({ playAsync: mockPlay, pauseAsync: mockPause, stopAsync: mockStop, seekAsync: mockSeek }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ChatBubble } = require("../mobile/src/components/chat/ChatBubble");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setRecordingSession } = require("../mobile/src/services/voiceSession");

const PATH = "f6c60000-0000-4000-8000-000000000001/voice_1.m4a";
const voice = {
  id: "11111111-1111-4111-8111-111111111111",
  matchId: "f6c60000-0000-4000-8000-000000000001",
  sender: "bbbbbbbb-0000-4000-8000-000000000002",
  from: "them" as const,
  text: "Voice message",
  at: Date.now(),
  status: "sent" as const,
  messageType: "voice" as const,
  audioDurationSec: 10,
  audioPath: PATH,
};

let panConfig: any;
const realCreate = PanResponder.create;
let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  setRecordingSession(false);
  mockPlay.mockResolvedValue({ success: true });
  panConfig = undefined;
  jest.spyOn(PanResponder, "create").mockImplementation((cfg: any) => {
    panConfig = cfg;
    return realCreate(cfg);
  });
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

const render = (props: Record<string, unknown>) => {
  let r!: TestRenderer.ReactTestRenderer;
  act(() => {
    r = TestRenderer.create(<ChatBubble {...(props as any)} />);
  });
  return r;
};
const texts = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAllByType(Text).map((n) => React.Children.toArray(n.props.children).join(""));
const playBtn = (r: TestRenderer.ReactTestRenderer) => r.root.findByProps({ testID: "voice-play" });
const tap = async (r: TestRenderer.ReactTestRenderer) => {
  await act(async () => {
    await playBtn(r).props.onPress();
  });
};
const layout = (r: TestRenderer.ReactTestRenderer, width = 100) =>
  act(() => {
    r.root.findByProps({ testID: "voice-seek" }).props.onLayout({ nativeEvent: { layout: { width } } });
  });
const touch = (x: number) => ({ nativeEvent: { locationX: x } });

describe("live voice note plays on the first tap", () => {
  it("signs the path on tap when the live message has no URL", async () => {
    const resolve = jest.fn(async () => "https://signed/voice_1");
    const r = render({ message: voice, resolveAudioUrl: resolve });
    await tap(r);
    expect(resolve).toHaveBeenCalledWith(PATH);
    expect(mockPlay).toHaveBeenCalledWith("https://signed/voice_1", expect.any(Function), undefined);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("plays directly when the message already has a signed URL (own just-sent note)", async () => {
    const resolve = jest.fn();
    const r = render({ message: { ...voice, from: "me", audio: "https://signed/mine" }, resolveAudioUrl: resolve });
    await tap(r);
    expect(resolve).not.toHaveBeenCalled();
    expect(mockPlay).toHaveBeenCalledWith("https://signed/mine", expect.any(Function), undefined);
  });

  it("shows a clear error instead of doing nothing when no URL can be obtained", async () => {
    const r = render({ message: voice, resolveAudioUrl: jest.fn(async () => undefined) });
    await tap(r);
    expect(mockPlay).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith("Voice message", expect.stringMatching(/could not be loaded/i));

    const r2 = render({ message: { ...voice, audioPath: undefined } });
    await tap(r2);
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshes an expired link once and retries", async () => {
    mockPlay.mockResolvedValueOnce({ success: false, error: "Could not play this voice message. It may have expired." }).mockResolvedValueOnce({ success: true });
    const resolve = jest.fn(async () => "https://signed/fresh");
    const r = render({ message: { ...voice, audio: "https://signed/old" }, resolveAudioUrl: resolve });
    await tap(r);
    expect(mockPlay).toHaveBeenNthCalledWith(1, "https://signed/old", expect.any(Function), undefined);
    expect(mockPlay).toHaveBeenNthCalledWith(2, "https://signed/fresh", expect.any(Function), undefined);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("reports the error when the retry fails too", async () => {
    mockPlay.mockResolvedValue({ success: false, error: "Could not play this voice message. It may have expired." });
    const r = render({ message: { ...voice, audio: "https://signed/old" }, resolveAudioUrl: jest.fn(async () => "https://signed/fresh") });
    await tap(r);
    expect(alertSpy).toHaveBeenCalledWith("Voice message", expect.stringMatching(/could not play/i));
  });
});

describe("recording blocks playback", () => {
  it("disables the play button while recording and does not start playback", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    expect(playBtn(r).props.disabled).toBe(false);
    act(() => setRecordingSession(true));
    expect(playBtn(r).props.disabled).toBe(true);
    await tap(r); // even if a press slips through
    expect(mockPlay).not.toHaveBeenCalled();
    act(() => setRecordingSession(false));
    expect(playBtn(r).props.disabled).toBe(false);
  });
});

describe("seek and clock", () => {
  it("shows the plain duration while idle and a running clock while playing", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    expect(texts(r)).toContain("10s");
    await tap(r);
    const cb = mockPlay.mock.calls[0][1];
    act(() => cb({ positionMs: 3000, durationMs: 10000, isPlaying: true, didJustFinish: false }));
    expect(texts(r)).toContain("0:03 / 0:10");
    act(() => cb({ positionMs: 0, durationMs: 0, isPlaying: false, didJustFinish: true }));
    expect(texts(r)).toContain("10s");
  });

  it("dragging then releasing seeks the loaded clip to that fraction", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    layout(r, 100);
    await tap(r);
    const cb = mockPlay.mock.calls[0][1];
    act(() => cb({ positionMs: 1000, durationMs: 10000, isPlaying: true, didJustFinish: false }));

    act(() => panConfig.onPanResponderGrant(touch(20)));
    act(() => panConfig.onPanResponderMove(touch(60)));
    expect(texts(r)).toContain("0:06 / 0:10"); // live preview while dragging
    await act(async () => panConfig.onPanResponderRelease(touch(60)));
    expect(mockSeek).toHaveBeenCalledWith(6000);
  });

  it("a status update during the drag does not move the thumb back", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    layout(r, 100);
    await tap(r);
    const cb = mockPlay.mock.calls[0][1];
    act(() => panConfig.onPanResponderGrant(touch(80)));
    act(() => cb({ positionMs: 1000, durationMs: 10000, isPlaying: true, didJustFinish: false }));
    expect(texts(r)).toContain("0:08 / 0:10");
    await act(async () => panConfig.onPanResponderRelease(touch(80)));
  });

  it("seeking before the first play makes playback start at that point", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    layout(r, 100);
    act(() => panConfig.onPanResponderGrant(touch(30)));
    await act(async () => panConfig.onPanResponderRelease(touch(30)));
    expect(mockSeek).not.toHaveBeenCalled();
    expect(texts(r)).toContain("0:03 / 0:10");
    await tap(r);
    expect(mockPlay).toHaveBeenCalledWith("https://signed/a", expect.any(Function), { positionMs: 3000 });
  });

  it("seeking while paused keeps it paused and seeks the loaded clip", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    layout(r, 100);
    await tap(r);
    await tap(r); // second tap pauses
    expect(mockPause).toHaveBeenCalled();
    act(() => panConfig.onPanResponderGrant(touch(50)));
    await act(async () => panConfig.onPanResponderRelease(touch(50)));
    expect(mockSeek).toHaveBeenCalledWith(5000);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("dragging to the very end hands the end position to the player (it finishes the clip)", async () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    layout(r, 100);
    await tap(r);
    act(() => panConfig.onPanResponderGrant(touch(500))); // beyond the track: clamped
    await act(async () => panConfig.onPanResponderRelease(touch(500)));
    expect(mockSeek).toHaveBeenCalledWith(10000);
  });

  it("does not take touches while recording", () => {
    const r = render({ message: { ...voice, audio: "https://signed/a" } });
    expect(panConfig.onStartShouldSetPanResponder()).toBe(true);
    act(() => setRecordingSession(true));
    expect(panConfig.onStartShouldSetPanResponder()).toBe(false);
    expect(panConfig.onPanResponderTerminationRequest()).toBe(false);
    act(() => setRecordingSession(false));
    r.unmount();
  });
});
