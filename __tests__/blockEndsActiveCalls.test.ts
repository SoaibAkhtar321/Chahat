// Audit fix: blocking keeps the chat but must still end a call that is ringing or running between the pair.
import fs from "fs";
import path from "path";

const dir = path.join(__dirname, "..", "supabase", "migrations");
const sql = fs.readFileSync(path.join(dir, "20260101007400_block_ends_active_calls.sql"), "utf8");

describe("block ends active calls (20260101007400)", () => {
  it("sorts after the WhatsApp-style block migration so it is the final on_block_cleanup", () => {
    const names = fs.readdirSync(dir).filter((f) => f.includes("on_block") || f.includes("block") || f.includes("unmatch"));
    expect(names).toContain("20260101007200_whatsapp_style_blocking.sql");
    expect("20260101007400_block_ends_active_calls.sql" > "20260101007200_whatsapp_style_blocking.sql").toBe(true);
  });
  it("cancels ringing and ends running calls in both directions", () => {
    expect(sql).toMatch(/CASE WHEN c\.status = 'pending' THEN 'cancelled' ELSE 'ended' END/);
    expect(sql).toMatch(/c\.caller_id = NEW\.blocker::uuid AND c\.recipient_id = NEW\.blocked::uuid/);
    expect(sql).toMatch(/c\.caller_id = NEW\.blocked::uuid AND c\.recipient_id = NEW\.blocker::uuid/);
  });
  it("never deletes the match, messages or swipes", () => {
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });
});
