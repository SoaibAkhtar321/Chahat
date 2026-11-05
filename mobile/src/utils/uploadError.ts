/**
 * Turns a Supabase Storage / network error into the real reason, worded so the member knows what to do.
 * The original message is kept in brackets for anything not recognised, so no reason is ever hidden.
 */
export function describeUploadError(err: unknown): Error {
  const anyErr = err as { message?: string; statusCode?: string | number; status?: number; error?: string } | null;
  const raw = String(anyErr?.message ?? anyErr?.error ?? err ?? "").trim();
  const status = Number(anyErr?.statusCode ?? anyErr?.status ?? 0);
  const m = raw.toLowerCase();

  if (status === 413 || m.includes("maximum allowed size") || m.includes("payload too large") || m.includes("too large")) {
    return new Error("This photo is larger than the 5 MB limit. Please choose a smaller photo.");
  }
  if (status === 415 || m.includes("mime type") || m.includes("invalid_mime") || m.includes("not supported")) {
    return new Error("This file type is not accepted. Please upload a JPEG, PNG or WEBP photo.");
  }
  if (m.includes("row-level security") || m.includes("unauthorized") || status === 403) {
    return new Error("Upload was refused for your account. Please sign out, sign in again and retry.");
  }
  if (m.includes("jwt") || m.includes("expired") || status === 401) {
    return new Error("Your session has expired. Please sign in again and retry the upload.");
  }
  if (status === 409 || m.includes("already exists") || m.includes("duplicate")) {
    return new Error("This photo was already uploaded. Please remove it and add it again.");
  }
  if (status === 429 || m.includes("rate limit") || m.includes("too many")) {
    return new Error("Too many uploads in a short time. Please wait a minute and try again.");
  }
  if (m.includes("network request failed") || m.includes("failed to fetch") || m.includes("timeout") || m.includes("network")) {
    return new Error("No internet connection or the connection dropped. Check your network and try again.");
  }
  if (status >= 500) {
    return new Error(`Our server could not save the photo right now (error ${status}). Please try again in a few minutes.`);
  }
  return new Error(`Upload failed: ${raw || "unknown error"}. Please try again.`);
}
