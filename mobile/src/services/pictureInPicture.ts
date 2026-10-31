// Floating video-call window (Android picture-in-picture), like WhatsApp: press back or home during a connected
// video call and the call shrinks into a small movable window over whatever you open next; tap it to go back.
// Backed by the local native module in mobile/modules/call-state. Best effort: if the module is missing
// (tests, Expo Go, iOS, old builds) everything here reports "not supported" and the call screen keeps its
// normal back-button dialog.
import { Platform } from "react-native";

interface PipModule {
  isPictureInPictureSupported?(): boolean;
  isInPictureInPictureMode?(): boolean;
  setPictureInPictureArmed?(armed: boolean): Promise<void>;
  enterPictureInPicture?(): Promise<boolean>;
}

let nativeModule: PipModule | null | undefined;

function loadModule(): PipModule | null {
  if (nativeModule !== undefined) return nativeModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expo = require("expo");
    nativeModule = (expo.requireOptionalNativeModule?.("ChahatCallState") as PipModule | null | undefined) ?? null;
  } catch {
    nativeModule = null;
  }
  return nativeModule ?? null;
}

/** For tests. */
export function __setPictureInPictureModuleForTests(mod: PipModule | null | undefined): void {
  nativeModule = mod;
}

/** Only a connected video call is shrunk into the window; ringing and connecting keep the confirm dialog. */
export function shouldMinimizeOnBack(input: {
  status: string;
  mediaPhase: string;
  callKind: string | null;
  supported: boolean;
}): boolean {
  return (
    input.supported &&
    input.callKind === "video" &&
    input.status === "accepted" &&
    input.mediaPhase === "connected"
  );
}

/** Width below which the window is treated as the floating box (a phone screen is far wider than this). */
export const PIP_MAX_WIDTH_DP = 260;

export function isPictureInPictureSupported(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return loadModule()?.isPictureInPictureSupported?.() === true;
  } catch {
    return false;
  }
}

export function isInPictureInPicture(): boolean {
  if (Platform.OS !== "android") return false;
  try {
    return loadModule()?.isInPictureInPictureMode?.() === true;
  } catch {
    return false;
  }
}

/** Arms (or disarms) the automatic window when the user leaves the app during a call. Never throws. */
export async function setPictureInPictureArmed(armed: boolean): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await loadModule()?.setPictureInPictureArmed?.(armed);
  } catch {
    // Best effort.
  }
}

/** Shrinks the app into the floating window. Resolves false when Android refuses or it is unavailable. */
export async function enterPictureInPicture(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    return (await loadModule()?.enterPictureInPicture?.()) === true;
  } catch {
    return false;
  }
}
