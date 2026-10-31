import { supabase } from "./supabase";

export async function blockUser(targetId: string): Promise<boolean> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    // Block like WhatsApp: only the block row is created. The match, the chat and its messages stay for both
    // people (the server hides the blocked person's new messages from the blocker; see 20260101007200).
    const { error: blockErr } = await supabase.from("blocks").insert({
      blocker: uid,
      blocked: targetId,
    });
    if (blockErr) {
      console.warn("blockUser: block insertion failed", blockErr.message);
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

export async function unblockUser(targetId: string): Promise<boolean> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return false;

    const { error } = await supabase
      .from("blocks")
      .delete()
      .eq("blocker", uid)
      .eq("blocked", targetId);

    return !error;
  } catch {
    return false;
  }
}

export interface BlockedUser {
  id: string;
  name: string;
  blockedAt: string;
}

/** The signed-in member's own block list (Settings → Blocked accounts). */
export async function fetchBlockedUsers(): Promise<BlockedUser[]> {
  try {
    const { data, error } = await supabase.rpc("get_my_blocked_users");
    if (error || !Array.isArray(data)) return [];
    return data
      .filter((r: any) => typeof r?.id === "string")
      .map((r: any) => ({ id: r.id, name: r.name || "Member", blockedAt: r.blocked_at ?? "" }));
  } catch {
    return [];
  }
}

export async function reportUser(
  targetId: string,
  category: string,
  note: string,
  source: "profile" | "chat" | "call" = "profile",
): Promise<{ success: boolean; error?: string }> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return { success: false, error: "Authentication required" };

    const { error } = await supabase.from("reports").insert({
      reporter: uid,
      target: targetId,
      category: category.slice(0, 60),
      note: note.slice(0, 500),
      source,
      status: "open",
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to submit report" };
  }
}

export async function unmatchUser(matchId: string): Promise<boolean> {
  try {
    // Server-side: closes any call on the match first, then removes the match (see 20260101007300).
    const { data, error } = await supabase.rpc("unmatch_user", { _match_id: matchId });
    return !error && data?.success === true;
  } catch {
    return false;
  }
}

/**
 * Whether this match still exists for me: true / false, or null when it could not be checked (offline etc.).
 * Used to leave a chat the other person has unmatched, without ever guessing from a failed network call.
 */
export async function matchStillExists(matchId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from("matches").select("id").eq("id", matchId).maybeSingle();
    if (error) return null;
    return data !== null;
  } catch {
    return null;
  }
}
