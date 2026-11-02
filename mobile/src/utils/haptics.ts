import { Vibration } from "react-native";

/**
 * A very short tap for gesture feedback. Uses React Native's Vibration (the VIBRATE permission is already declared in
 * app.json), so no new native module is needed. Never throws: haptics are a nicety, not a requirement.
 */
export function lightHaptic(): void {
  try {
    Vibration.vibrate(12);
  } catch {
    // Device without a vibrator, or vibration disabled: ignore.
  }
}
