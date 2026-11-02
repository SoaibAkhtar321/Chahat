// Phase B.1: a voice note that arrives live (Realtime) must carry a signed URL so the first tap plays it.
const mockGetSignedUrls = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);

const handlers: Record<string, (payload: any) => void> = {};
const mockChannel: any = {
  on: jest.fn((_type: string, cfg: any, cb: (p: any) => void) => {
    handlers[`${cfg.event}:${cfg.table}`] = cb;
    return mockChannel;
  }),
  subscribe: jest.fn(() => mockChannel),
};
jest.mock("../mobile/src/services/supabase", () => ({
  isSupabaseConfigured: () => true,
  supabase: { channel: jest.fn(() => mockChannel), rpc: jest.fn(), from: jest.fn(), storage: { from: jest.fn() } },
}));
jest.mock("../mobile/src/services/storage", () => ({
  getSignedUrls: (...a: unknown[]) => mockGetSignedUrls(...a),
  getSignedUrl: (...a: unknown[]) => mockGetSignedUrl(...a),
  prepareVoiceUpload: jest.fn(),
  sanitizeAndPrepareImageUpload: jest.fn(),
  imageFileExtension: jest.fn(),
}));
jest.mock("../mobile/src/services/notifications", () => ({ pushNotificationToInbox: jest.fn(async () => undefined) }));

import { realtimeMediaPaths, resolveChatMediaUrl, subscribeToMatchMessages } from "../mobile/src/services/chat";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";

const voiceRow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  match_id: MATCH,
  sender: THEM,
  body: "Voice message",
  audio_path: `${MATCH}/voice_1.m4a`,
  audio_duration_sec: 7,
  message_type: "voice",
  created_at: "2026-11-01T10:00:00Z",
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("realtimeMediaPaths", () => {
  it("returns the voice path and the photo path of a live row", () => {
    expect(realtimeMediaPaths(voiceRow({ image_path: "p/i.jpg" }), ME)).toEqual([`${MATCH}/voice_1.m4a`, "p/i.jpg"]);
  });
  it("skips deleted rows and an unopened View Once photo from the partner", () => {
    expect(realtimeMediaPaths(voiceRow({ deleted_at: "2026-11-01T11:00:00Z" }), ME)).toEqual([]);
    expect(realtimeMediaPaths({ sender: THEM, image_path: "p/i.jpg", is_view_once: true, viewed_at: null }, ME)).toEqual([]);
    expect(realtimeMediaPaths({ sender: ME, image_path: "p/i.jpg", is_view_once: true, viewed_at: null }, ME)).toEqual(["p/i.jpg"]);
  });
  it("returns nothing for a text row", () => {
    expect(realtimeMediaPaths({ sender: THEM, body: "hi", message_type: "text" }, ME)).toEqual([]);
  });
});

describe("live voice note delivery", () => {
  it("signs the audio path before handing the message to the screen", async () => {
    const path = `${MATCH}/voice_1.m4a`;
    mockGetSignedUrls.mockResolvedValue({ [path]: "https://signed/voice_1" });
    const received: any[] = [];
    subscribeToMatchMessages(MATCH, (m) => received.push(m), ME);

    handlers["INSERT:messages"]!({ new: voiceRow() });
    expect(received).toHaveLength(0); // waits for the signature
    await new Promise((r) => setImmediate(r));

    expect(mockGetSignedUrls).toHaveBeenCalledWith("chat", [path]);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ audio: "https://signed/voice_1", audioPath: path, messageType: "voice", from: "them" });
  });

  it("still delivers the message (with its path) when signing fails, so the bubble can sign on tap", async () => {
    mockGetSignedUrls.mockRejectedValue(new Error("network"));
    const received: any[] = [];
    subscribeToMatchMessages(MATCH, (m) => received.push(m), ME);
    handlers["INSERT:messages"]!({ new: voiceRow() });
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0].audio).toBeUndefined();
    expect(received[0].audioPath).toBe(`${MATCH}/voice_1.m4a`);
  });

  it("delivers text messages immediately without signing", () => {
    const received: any[] = [];
    subscribeToMatchMessages(MATCH, (m) => received.push(m), ME);
    handlers["INSERT:messages"]!({ new: { id: "22222222-2222-4222-8222-222222222222", match_id: MATCH, sender: THEM, body: "hello", message_type: "text", created_at: "2026-11-01T10:00:00Z" } });
    expect(received).toHaveLength(1);
    expect(mockGetSignedUrls).not.toHaveBeenCalled();
  });
});

describe("resolveChatMediaUrl", () => {
  it("signs a chat path and never throws", async () => {
    mockGetSignedUrl.mockResolvedValueOnce("https://signed/x");
    await expect(resolveChatMediaUrl("a/b.m4a")).resolves.toBe("https://signed/x");
    expect(mockGetSignedUrl).toHaveBeenCalledWith("chat", "a/b.m4a");
    mockGetSignedUrl.mockRejectedValueOnce(new Error("boom"));
    await expect(resolveChatMediaUrl("a/b.m4a")).resolves.toBeUndefined();
    await expect(resolveChatMediaUrl("")).resolves.toBeUndefined();
  });
});
