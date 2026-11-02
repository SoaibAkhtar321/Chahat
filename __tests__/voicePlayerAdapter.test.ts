// Phase B.2 + B.3: recording never overlaps playback, and clips can be sought.
jest.mock("expo-file-system/legacy", () => ({ deleteAsync: jest.fn(async () => undefined), getInfoAsync: jest.fn(async () => ({ exists: true, size: 16384 })) }), { virtual: true });
jest.mock(
  "expo-av",
  () => {
    const recording = {
      prepareToRecordAsync: jest.fn(async () => undefined),
      startAsync: jest.fn(async () => undefined),
      stopAndUnloadAsync: jest.fn(async () => ({ durationMillis: 4200 })),
      getURI: jest.fn(() => "file:///cache/rec.m4a"),
    };
    let statusCb: ((s: any) => void) | null = null;
    const sound = {
      playAsync: jest.fn(async () => undefined),
      pauseAsync: jest.fn(async () => undefined),
      stopAsync: jest.fn(async () => undefined),
      unloadAsync: jest.fn(async () => undefined),
      setPositionAsync: jest.fn(async () => undefined),
      getStatusAsync: jest.fn(async () => ({ isLoaded: true, isPlaying: true, durationMillis: 10000, positionMillis: 1000 })),
    };
    return {
      __recording: recording,
      __sound: sound,
      __emitStatus: (s: any) => statusCb?.(s),
      Audio: {
        requestPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
        setAudioModeAsync: jest.fn(async () => undefined),
        Recording: jest.fn(() => recording),
        Sound: {
          createAsync: jest.fn(async (_src: any, _opts: any, cb: (s: any) => void) => {
            statusCb = cb;
            return { sound };
          }),
        },
      },
    };
  },
  { virtual: true },
);

import { getAudioPlayerAdapter, getAudioRecorderAdapter } from "../mobile/src/services/voiceMedia";
import { formatClock, isRecordingSession, setRecordingSession } from "../mobile/src/services/voiceSession";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const av = require("expo-av");
const URL1 = "https://example.com/a.m4a";

beforeEach(async () => {
  jest.clearAllMocks();
  setRecordingSession(false);
  await getAudioPlayerAdapter().stopAsync();
  await getAudioRecorderAdapter().cancelRecordingAsync();
  jest.clearAllMocks();
  av.__sound.getStatusAsync.mockResolvedValue({ isLoaded: true, isPlaying: true, durationMillis: 10000, positionMillis: 1000 });
});

describe("recording and playback never overlap", () => {
  it("starting a recording stops a playing clip first and tells its bubble", async () => {
    const player = getAudioPlayerAdapter();
    const updates: any[] = [];
    await player.playAsync(URL1, (s) => updates.push(s));
    expect(player.isPlaying()).toBe(true);

    const res = await getAudioRecorderAdapter().startRecordingAsync();
    expect(res.success).toBe(true);
    expect(player.isPlaying()).toBe(false);
    expect(av.__sound.unloadAsync).toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ isPlaying: false, didJustFinish: true });
    // The sound was unloaded before the microphone mode was switched on.
    const stopOrder = av.__sound.stopAsync.mock.invocationCallOrder[0];
    const micCall = av.Audio.setAudioModeAsync.mock.calls.findIndex((c: any[]) => c[0]?.allowsRecordingIOS === true);
    expect(micCall).toBeGreaterThanOrEqual(0);
    const modeOrder = av.Audio.setAudioModeAsync.mock.invocationCallOrder[micCall];
    expect(stopOrder).toBeLessThan(modeOrder);
    await getAudioRecorderAdapter().cancelRecordingAsync();
  });

  it("playback is refused while a recording is active and works again afterwards", async () => {
    const recorder = getAudioRecorderAdapter();
    const player = getAudioPlayerAdapter();
    await recorder.startRecordingAsync();
    expect(recorder.isRecording()).toBe(true);

    const blocked = await player.playAsync(URL1);
    expect(blocked.success).toBe(false);
    expect(blocked.error).toMatch(/finish recording/i);
    expect(av.Audio.Sound.createAsync).not.toHaveBeenCalled();

    await recorder.stopRecordingAsync();
    const ok = await player.playAsync(URL1);
    expect(ok.success).toBe(true);
  });

  it("playback is refused while the screen holds the recording session (mic still starting)", async () => {
    setRecordingSession(true);
    expect(isRecordingSession()).toBe(true);
    const res = await getAudioPlayerAdapter().playAsync(URL1);
    expect(res.success).toBe(false);
    expect(av.Audio.Sound.createAsync).not.toHaveBeenCalled();
    setRecordingSession(false);
  });

  it("restores the playback audio mode after recording stops or is cancelled", async () => {
    const recorder = getAudioRecorderAdapter();
    await recorder.startRecordingAsync();
    await recorder.stopRecordingAsync();
    expect(av.Audio.setAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecordingIOS: false, playsInSilentModeIOS: true }));

    av.Audio.setAudioModeAsync.mockClear();
    await recorder.startRecordingAsync();
    await recorder.cancelRecordingAsync();
    expect(av.Audio.setAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecordingIOS: false }));
  });

  it("a failed start leaves playback allowed", async () => {
    av.__recording.startAsync.mockRejectedValueOnce(new Error("busy"));
    const res = await getAudioRecorderAdapter().startRecordingAsync();
    expect(res.success).toBe(false);
    expect((await getAudioPlayerAdapter().playAsync(URL1)).success).toBe(true);
  });
});

describe("seek", () => {
  it("moves a playing clip and reports the new position", async () => {
    const player = getAudioPlayerAdapter();
    const updates: any[] = [];
    await player.playAsync(URL1, (s) => updates.push(s));
    await player.seekAsync(4000);
    expect(av.__sound.setPositionAsync).toHaveBeenCalledWith(4000);
    expect(updates.at(-1)).toMatchObject({ positionMs: 4000, durationMs: 10000, isPlaying: true, didJustFinish: false });
  });

  it("moves a paused clip without resuming it", async () => {
    const player = getAudioPlayerAdapter();
    const updates: any[] = [];
    await player.playAsync(URL1, (s) => updates.push(s));
    await player.pauseAsync();
    av.__sound.getStatusAsync.mockResolvedValue({ isLoaded: true, isPlaying: false, durationMillis: 10000, positionMillis: 1000 });
    av.__sound.playAsync.mockClear();
    await player.seekAsync(2500);
    expect(av.__sound.setPositionAsync).toHaveBeenCalledWith(2500);
    expect(av.__sound.playAsync).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ positionMs: 2500, isPlaying: false, didJustFinish: false });
    expect(player.isPlaying()).toBe(false);
  });

  it("seeking to or past the end finishes the clip cleanly", async () => {
    const player = getAudioPlayerAdapter();
    const updates: any[] = [];
    await player.playAsync(URL1, (s) => updates.push(s));
    await player.seekAsync(10000);
    expect(av.__sound.setPositionAsync).not.toHaveBeenCalled();
    expect(av.__sound.unloadAsync).toHaveBeenCalled();
    expect(player.isPlaying()).toBe(false);
    expect(updates.at(-1)).toMatchObject({ isPlaying: false, didJustFinish: true });
    // A second seek with nothing loaded is a no-op, not an error.
    await expect(player.seekAsync(500)).resolves.toBeUndefined();
  });

  it("clamps negative positions to the start and ignores seeks when nothing is loaded", async () => {
    const player = getAudioPlayerAdapter();
    await expect(player.seekAsync(1000)).resolves.toBeUndefined();
    await player.playAsync(URL1);
    await player.seekAsync(-50);
    expect(av.__sound.setPositionAsync).toHaveBeenCalledWith(0);
  });

  it("can start playback at a chosen position (seek before the first play)", async () => {
    await getAudioPlayerAdapter().playAsync(URL1, undefined, { positionMs: 3000 });
    expect(av.Audio.Sound.createAsync).toHaveBeenCalledWith({ uri: URL1 }, expect.objectContaining({ shouldPlay: true, positionMillis: 3000 }), expect.any(Function));
  });

  it("stopping a clip resets the bubble that showed it (profile intro and chat share one player)", async () => {
    const player = getAudioPlayerAdapter();
    const updates: any[] = [];
    await player.playAsync(URL1, (s) => updates.push(s));
    await player.stopAsync();
    expect(updates.at(-1)).toMatchObject({ isPlaying: false, didJustFinish: true });
  });
});

describe("formatClock", () => {
  it("formats m:ss and tolerates bad input", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(65_400)).toBe("1:05");
    expect(formatClock(-5)).toBe("0:00");
    expect(formatClock(NaN)).toBe("0:00");
  });
});
