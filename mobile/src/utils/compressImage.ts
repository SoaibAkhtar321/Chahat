import * as ImageManipulator from "expo-image-manipulator";

/** Target size for every profile photo. WebP at 1080px is sharp on any phone and usually 120–300 KB. */
export const MAX_PROFILE_PHOTO_BYTES = 350_000;

const START_WIDTH = 1080; // 1080x1440 for a 3:4 photo is plenty for a profile card
const MIN_WIDTH = 480;
const QUALITIES = [0.75, 0.65, 0.55, 0.45];
// WebP is ~25–35% smaller than JPEG at the same visual quality; both buckets accept image/webp.
const OUTPUT_FORMAT = ImageManipulator.SaveFormat.WEBP;

async function sizeOf(uri: string): Promise<number> {
  let size = 0;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system/legacy");
    const info = await FileSystem.getInfoAsync(uri);
    size = info?.exists && typeof info.size === "number" ? info.size : 0;
  } catch {
    size = 0;
  }
  if (size === 0) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error("The photo could not be read after compressing. Please try again.");
    size = (await res.blob()).size;
  }
  if (size === 0) throw new Error("The photo file is empty or damaged. Please choose a different photo.");
  return size;
}

/** Real reason for a native decode/encode failure, in words a member can act on. */
function decodeFailure(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/heic|heif|unsupported|decode|bitmap|null/i.test(raw)) {
    return new Error(
      "This photo's format could not be opened on this phone. Please choose a JPEG or PNG photo, or take a screenshot of it and upload that.",
    );
  }
  if (/memory|oom/i.test(raw)) {
    return new Error("This photo is too large for your phone to process. Please choose a smaller photo.");
  }
  if (/permission|denied|access/i.test(raw)) {
    return new Error("The app could not access this photo. Please pick it again from the gallery.");
  }
  return new Error(`The photo could not be prepared for upload (${raw || "unknown error"}). Please try a different photo.`);
}

async function encode(uri: string, width: number | null, quality: number) {
  try {
    return await ImageManipulator.manipulateAsync(uri, width ? [{ resize: { width } }] : [], {
      compress: quality,
      format: OUTPUT_FORMAT,
    });
  } catch (err) {
    throw decodeFailure(err);
  }
}

async function compressLoop(uri: string, maxWidth: number, maxBytes: number, knownWidth?: number): Promise<string> {
  let srcWidth = knownWidth && knownWidth > 0 ? knownWidth : 0;
  if (!srcWidth) srcWidth = (await encode(uri, null, 1)).width || maxWidth;
  // Never enlarge a small photo.
  let width = Math.min(srcWidth, maxWidth);
  const floor = Math.min(MIN_WIDTH, width);
  while (width >= floor) {
    for (const quality of QUALITIES) {
      const out = await encode(uri, width, quality);
      if ((await sizeOf(out.uri)) <= maxBytes) return out.uri;
    }
    if (width === floor) break;
    width = Math.max(floor, Math.floor(width * 0.8));
  }
  throw new Error(
    "This photo has too much detail to be made small enough. Please choose a different photo or crop it tighter.",
  );
}

/**
 * Resizes (max 1080px wide, never enlarged) and re-encodes a picked image as WebP until it is under maxBytes.
 * Re-encoding also drops EXIF/GPS metadata. Returns the URI of the compressed file.
 */
export async function compressToUnderLimit(
  uri: string,
  originalWidth?: number,
  maxBytes: number = MAX_PROFILE_PHOTO_BYTES,
): Promise<string> {
  return compressLoop(uri, START_WIDTH, maxBytes, originalWidth);
}

/** Chat photos: plenty for a phone screen, and a fraction of a camera original (often 4–8 MB). */
export const CHAT_PHOTO_MAX_WIDTH = 1280;
export const MAX_CHAT_PHOTO_BYTES = 300_000;

const GIF_BASE64_PREFIX = "R0lGOD"; // "GIF8" in base64

/** True when the file starts with a GIF header (animated GIFs must be sent as they are). */
export async function isGifFile(uri: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FileSystem = require("expo-file-system/legacy");
    const head: string = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 6,
    });
    return head.startsWith(GIF_BASE64_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Prepares a chat photo before upload: GIFs are kept as they are; every other image is re-encoded as WebP, at most
 * CHAT_PHOTO_MAX_WIDTH wide (never enlarged) and under MAX_CHAT_PHOTO_BYTES. Re-encoding also drops EXIF/GPS.
 */
export async function compressChatImage(uri: string): Promise<string> {
  if (await isGifFile(uri)) return uri;
  return compressLoop(uri, CHAT_PHOTO_MAX_WIDTH, MAX_CHAT_PHOTO_BYTES);
}
