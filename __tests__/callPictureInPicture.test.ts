// Phase 5: floating video-call window (picture-in-picture), the back button during a call, and the manifest flags.
import fs from "fs";
import path from "path";

let mockOs = "android";
jest.mock("react-native", () => ({ Platform: { get OS() { return mockOs; } } }));

import {
  __setPictureInPictureModuleForTests,
  enterPictureInPicture,
  isInPictureInPicture,
  isPictureInPictureSupported,
  setPictureInPictureArmed,
  shouldMinimizeOnBack,
} from "../mobile/src/services/pictureInPicture";
import {
  isOnCallScreen,
  ongoingCallText,
  parseOngoingCallData,
} from "../mobile/src/services/ongoingCallPolicy";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyPictureInPictureToActivity } = require("../mobile/app.config.js");

const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

beforeEach(() => {
  mockOs = "android";
  __setPictureInPictureModuleForTests(undefined);
});

describe("shouldMinimizeOnBack", () => {
  const live = { status: "accepted", mediaPhase: "connected", callKind: "video", supported: true };
  it("shrinks only a connected video call on a phone that supports the window", () => {
    expect(shouldMinimizeOnBack(live)).toBe(true);
    expect(shouldMinimizeOnBack({ ...live, supported: false })).toBe(false);
    expect(shouldMinimizeOnBack({ ...live, mediaPhase: "joining" })).toBe(false);
    expect(shouldMinimizeOnBack({ ...live, status: "pending" })).toBe(false);
    expect(shouldMinimizeOnBack({ ...live, callKind: null })).toBe(false);
  });
});

describe("pictureInPicture service", () => {
  it("reports unsupported and does nothing when the native module is missing", async () => {
    __setPictureInPictureModuleForTests(null);
    expect(isPictureInPictureSupported()).toBe(false);
    expect(isInPictureInPicture()).toBe(false);
    await expect(enterPictureInPicture()).resolves.toBe(false);
    await expect(setPictureInPictureArmed(true)).resolves.toBeUndefined();
  });

  it("is never available off Android", async () => {
    mockOs = "ios";
    const enter = jest.fn(async () => true);
    __setPictureInPictureModuleForTests({ isPictureInPictureSupported: () => true, enterPictureInPicture: enter });
    expect(isPictureInPictureSupported()).toBe(false);
    await expect(enterPictureInPicture()).resolves.toBe(false);
    expect(enter).not.toHaveBeenCalled();
  });

  it("passes through to the native module and never throws", async () => {
    const arm = jest.fn(async () => undefined);
    __setPictureInPictureModuleForTests({
      isPictureInPictureSupported: () => true,
      isInPictureInPictureMode: () => true,
      setPictureInPictureArmed: arm,
      enterPictureInPicture: async () => true,
    });
    expect(isPictureInPictureSupported()).toBe(true);
    expect(isInPictureInPicture()).toBe(true);
    await setPictureInPictureArmed(true);
    expect(arm).toHaveBeenCalledWith(true);
    await expect(enterPictureInPicture()).resolves.toBe(true);

    __setPictureInPictureModuleForTests({
      isPictureInPictureSupported: () => {
        throw new Error("boom");
      },
      setPictureInPictureArmed: async () => {
        throw new Error("boom");
      },
      enterPictureInPicture: async () => {
        throw new Error("boom");
      },
    });
    expect(isPictureInPictureSupported()).toBe(false);
    await expect(setPictureInPictureArmed(true)).resolves.toBeUndefined();
    await expect(enterPictureInPicture()).resolves.toBe(false);
  });
});

describe("ongoing call notification rules", () => {
  const callId = "11111111-1111-4111-8111-111111111111";
  const matchId = "22222222-2222-4222-8222-222222222222";

  it("accepts only well-formed ongoing-call data", () => {
    expect(parseOngoingCallData({ category: "ongoing_call", callId: callId.toUpperCase(), matchId })).toEqual({
      callId,
      matchId,
    });
    expect(parseOngoingCallData({ category: "call", callId, matchId })).toBeNull();
    expect(parseOngoingCallData({ category: "ongoing_call", callId: "nope", matchId })).toBeNull();
    expect(parseOngoingCallData({ category: "ongoing_call", callId })).toBeNull();
    expect(parseOngoingCallData(null)).toBeNull();
  });

  it("does not open a second call screen when one is already showing", () => {
    expect(isOnCallScreen("/call/abc")).toBe(true);
    expect(isOnCallScreen("/chat/abc")).toBe(false);
    expect(isOnCallScreen(undefined)).toBe(false);
  });

  it("says tap to return to call", () => {
    expect(ongoingCallText("Asha")).toEqual({ title: "Video call with Asha", body: "Ongoing call · Tap to return to call" });
    expect(ongoingCallText("  ").title).toBe("Video call");
  });
});

describe("Android manifest flags", () => {
  it("turns on picture-in-picture and keeps every size change handled in-app", () => {
    const activity = applyPictureInPictureToActivity({
      $: { "android:name": ".MainActivity", "android:configChanges": "keyboard|keyboardHidden|orientation|screenSize|screenLayout|uiMode" },
    });
    expect(activity.$["android:supportsPictureInPicture"]).toBe("true");
    const changes = activity.$["android:configChanges"].split("|");
    expect(changes).toEqual(expect.arrayContaining(["screenSize", "smallestScreenSize", "screenLayout", "orientation"]));
    expect(new Set(changes).size).toBe(changes.length);
  });

  it("works when the activity has no configChanges yet", () => {
    const activity = applyPictureInPictureToActivity({ $: { "android:name": ".MainActivity" } });
    expect(activity.$["android:configChanges"]).toContain("smallestScreenSize");
  });
});

describe("call screen wiring", () => {
  const screen = read("mobile/app/call/[id].tsx");
  it("back on a connected video call goes to the floating window, other states keep the dialog", () => {
    expect(screen).toContain("shouldMinimizeOnBack");
    expect(screen).toContain("enterPictureInPicture()");
    expect(screen).toContain("confirmLeaveCall");
  });
  it("arms the window and the notification only while the call is live, and cleans both up", () => {
    expect(screen).toContain("setPictureInPictureArmed(true)");
    expect(screen).toContain("setPictureInPictureArmed(false)");
    expect(screen).toContain("showOngoingCallNotification");
    expect(screen).toContain("dismissOngoingCallNotification");
  });
  it("native module exposes the window functions", () => {
    const kt = read("mobile/modules/call-state/android/src/main/java/expo/modules/callstate/CallStateModule.kt");
    for (const name of ["isPictureInPictureSupported", "isInPictureInPictureMode", "setPictureInPictureArmed", "enterPictureInPicture", "getAudioMode"]) {
      expect(kt).toContain(`"${name}"`);
    }
  });
});
