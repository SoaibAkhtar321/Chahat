import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MINE_ID = "11111111-1111-4111-8111-111111111111";
const THEIRS_ID = "22222222-2222-4222-8222-222222222222";

// Stable references, like the real providers: the screen's effects depend on `user`.
const mockUser = { id: ME };
const mockMatches = [
  {
    id: MATCH,
    otherUser: { id: THEM, name: "Ananya", age: 25, city: "", distanceKm: null, bio: "", photos: [], interests: [], intent: "" },
    createdAt: "2026-10-01T00:00:00Z",
    unreadCount: 0,
  },
];
const mockClearUnread = jest.fn();
const mockMiloValue = { matches: mockMatches, refreshMatches: (...a: unknown[]) => mockRefresh(...a), clearUnread: (...a: unknown[]) => mockClearUnread(...a) };

const mockFetch = jest.fn();
const mockDelete = jest.fn();
const mockRefresh = jest.fn();
const mockAlert = jest.fn();
const mockMarkRead = jest.fn();
let mockHandlers: any;
let mockOnReceived: ((m: any) => void) | undefined;

jest.mock(
  "@react-native-async-storage/async-storage",
  () => ({
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true },
);
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "f6c60000-0000-4000-8000-000000000001" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useFocusEffect: () => undefined,
}));
jest.mock("expo-image", () => {
  const { View } = require("react-native");
  return { Image: View };
});
jest.mock("expo-image-picker", () => ({ MediaTypeOptions: { Images: "Images" } }));
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("../mobile/src/components/profile/ProfilePhoto", () => ({ ProfilePhoto: () => null }));
jest.mock("../mobile/src/components/chat/CoupleGamesModal", () => ({ CoupleGamesModal: () => null }));
jest.mock("../mobile/src/context/AuthContext", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("../mobile/src/context/MiloContext", () => ({ useMilo: () => mockMiloValue }));
jest.mock("../mobile/src/services/activeConversation", () => ({ setActiveConversation: jest.fn(), clearActiveConversation: jest.fn() }));
jest.mock("../mobile/src/services/calls", () => ({ buildNewCallRoute: jest.fn() }));
jest.mock("../mobile/src/services/callMedia", () => ({ isCallingAvailable: () => false }));
const mockMatchStillExists = jest.fn(async (..._a: unknown[]) => true as boolean | null);
jest.mock("../mobile/src/services/moderation", () => ({
  blockUser: jest.fn(),
  reportUser: jest.fn(),
  unmatchUser: jest.fn(),
  fetchBlockedUsers: jest.fn(async () => []),
  unblockUser: jest.fn(),
  matchStillExists: (...a: unknown[]) => mockMatchStillExists(...a),
}));
const mockRecorder = {
  requestPermissionsAsync: jest.fn(),
  startRecordingAsync: jest.fn(),
  stopRecordingAsync: jest.fn(),
  cancelRecordingAsync: jest.fn(async () => undefined),
};
const mockPlayer = { stopAsync: jest.fn(async () => undefined), pauseAsync: jest.fn(async () => undefined), playAsync: jest.fn() };
const mockCleanup = jest.fn(async () => undefined);
jest.mock("../mobile/src/services/voiceMedia", () => ({
  VOICE_LIMITS: { maxDurationMs: 60000 },
  getAudioRecorderAdapter: () => mockRecorder,
  cleanupAbandonedVoiceFile: (...a: unknown[]) => mockCleanup(...a),
  getAudioPlayerAdapter: () => mockPlayer,
}));
const mockSendVoice = jest.fn();
// Expo inlines EXPO_PUBLIC_* at transform time, so the flag is controlled through the config module.
let mockVoiceFlag = true;
jest.mock("../mobile/src/config/appConfig", () => ({
  isServiceConfigured: (name: string) => (name === "voiceMessages" ? mockVoiceFlag : false),
}));
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { removeChannel: jest.fn(), rpc: jest.fn() },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/chat", () => ({
  fetchMessagesForMatch: (...a: unknown[]) => mockFetch(...a),
  sendChatMessage: jest.fn(),
  sendVoiceMessage: (...a: unknown[]) => mockSendVoice(...a),
  markChatRead: (...a: unknown[]) => mockMarkRead(...a),
  fetchReactionsForMatch: jest.fn(async () => []),
  setMessageReaction: jest.fn(async () => ({ success: true })),
  subscribeToMatchMessages: (_m: string, onReceived: (m: any) => void, _u: string, handlers: any) => {
    mockOnReceived = onReceived;
    mockHandlers = handlers;
    return { id: "channel" };
  },
}));
jest.mock("../mobile/src/services/messageDeletion", () => ({
  ...jest.requireActual("../mobile/src/services/messageDeletion"),
  deleteMessage: (...a: unknown[]) => mockDelete(...a),
}));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: unknown[]) => mockAlert(...a) } }));


// eslint-disable-next-line @typescript-eslint/no-var-requires
const ChatDetailScreen = require("../mobile/app/chat/[id]").default;

let renderer: TestRenderer.ReactTestRenderer;
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

async function mount() {
  mockFetch.mockResolvedValue([]);
  await act(async () => {
    renderer = TestRenderer.create(<ChatDetailScreen />);
  });
  await flush();
}
const byId = (id: string) => renderer.root.findAll((n) => n.props?.testID === id && typeof n.props.onPress === "function")[0] ?? null;
const anyId = (id: string) => renderer.root.findAll((n) => n.props?.testID === id).length > 0;
const press = async (id: string) => {
  const n = byId(id);
  if (!n) throw new Error(`nothing to press: ${id}`);
  await act(async () => { await n.props.onPress(); });
};

const RESULT = { uri: "file:///cache/rec.m4a", durationMs: 4200, fileSizeBytes: 16384, mimeType: "audio/m4a" };

beforeEach(() => {
  jest.clearAllMocks();
  mockVoiceFlag = true;
  mockRecorder.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  mockRecorder.startRecordingAsync.mockResolvedValue({ success: true });
  mockRecorder.stopRecordingAsync.mockResolvedValue({ success: true, result: RESULT });
  mockSendVoice.mockResolvedValue({ success: true, message: { id: "m1", matchId: MATCH, sender: ME, from: "me", text: "Voice message", messageType: "voice", at: 5000, status: "sent", deletedAt: null } });
});
afterEach(async () => {
  await act(async () => { renderer?.unmount(); });
});

describe("chat composer voice messages", () => {
  test("mic is hidden when the voice flag is off (production default)", async () => {
    mockVoiceFlag = false;
    await mount();
    expect(anyId("voice-record")).toBe(false);
  });

  test("mic is shown when the flag is on", async () => {
    await mount();
    expect(anyId("voice-record")).toBe(true);
  });

  test("record then send uploads the real recording and deletes the local file", async () => {
    await mount();
    await press("voice-record");
    expect(mockRecorder.startRecordingAsync).toHaveBeenCalledWith(60000);
    expect(anyId("voice-recording-bar")).toBe(true);

    await press("voice-send");
    expect(mockRecorder.stopRecordingAsync).toHaveBeenCalledTimes(1);
    expect(mockSendVoice).toHaveBeenCalledWith(MATCH, ME, RESULT.uri, 4, "audio/m4a", undefined);
    expect(mockCleanup).toHaveBeenCalledWith(RESULT.uri);
    expect(anyId("voice-recording-bar")).toBe(false);
  });

  test("cancel discards the recording and sends nothing", async () => {
    await mount();
    await press("voice-record");
    await press("voice-cancel");
    expect(mockRecorder.cancelRecordingAsync).toHaveBeenCalledTimes(1);
    expect(mockRecorder.stopRecordingAsync).not.toHaveBeenCalled();
    expect(mockSendVoice).not.toHaveBeenCalled();
    expect(anyId("voice-recording-bar")).toBe(false);
  });

  test("denied microphone permission shows guidance and does not start recording", async () => {
    mockRecorder.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    await mount();
    await press("voice-record");
    expect(mockRecorder.startRecordingAsync).not.toHaveBeenCalled();
    expect(mockAlert).toHaveBeenCalledWith(expect.stringMatching(/microphone/i), expect.stringMatching(/Settings/));
    expect(anyId("voice-recording-bar")).toBe(false);
  });

  test("upload failure is reported and the local file is still removed", async () => {
    mockSendVoice.mockResolvedValue({ success: false, error: "Network request failed" });
    await mount();
    await press("voice-record");
    await press("voice-send");
    expect(mockAlert).toHaveBeenCalledWith(expect.stringMatching(/couldn't send/i), "Network request failed");
    expect(mockCleanup).toHaveBeenCalledWith(RESULT.uri);
  });

  test("a voice note sent after being blocked shows calm text, never the database error", async () => {
    mockSendVoice.mockResolvedValue({ success: false, error: 'new row violates row-level security policy for table "objects"' });
    await mount();
    await press("voice-record");
    await press("voice-send");
    expect(mockAlert).toHaveBeenCalledWith("Voice message not sent", expect.stringMatching(/Unblock .* to send messages/));
    expect(mockAlert).not.toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/row-level/i));
    expect(mockCleanup).toHaveBeenCalledWith(RESULT.uri);
  });

  test("a voice note sent after the other person unmatched leaves the conversation", async () => {
    mockSendVoice.mockResolvedValue({ success: false, error: "new row violates row-level security policy" });
    await mount();
    mockMatchStillExists.mockResolvedValue(false); // from now on the match is gone
    await press("voice-record");
    await press("voice-send");
    expect(mockAlert).toHaveBeenCalledWith("Conversation ended", expect.any(String));
    expect(mockAlert).not.toHaveBeenCalledWith("Voice message not sent", expect.anything());
  });

  test("leaving the chat mid-recording discards the recording", async () => {
    await mount();
    await press("voice-record");
    await act(async () => { renderer.unmount(); });
    expect(mockRecorder.cancelRecordingAsync).toHaveBeenCalled();
  });
});

describe("Phase B: recording never overlaps playback", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { isRecordingSession } = require("../mobile/src/services/voiceSession");

  test("starting a recording stops playing audio first and blocks playback until it ends", async () => {
    await mount();
    const order: string[] = [];
    mockPlayer.stopAsync.mockImplementation(async () => {
      order.push("stop-playback");
    });
    mockRecorder.startRecordingAsync.mockImplementation(async () => {
      order.push("start-mic");
      return { success: true };
    });
    await press("voice-record");
    expect(order).toEqual(["stop-playback", "start-mic"]);
    expect(isRecordingSession()).toBe(true);

    await press("voice-send");
    expect(isRecordingSession()).toBe(false);
  });

  test("cancel releases the block", async () => {
    await mount();
    await press("voice-record");
    expect(isRecordingSession()).toBe(true);
    await press("voice-cancel");
    expect(isRecordingSession()).toBe(false);
  });

  test("denied permission and a failed start do not leave playback blocked", async () => {
    mockRecorder.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await mount();
    await press("voice-record");
    expect(isRecordingSession()).toBe(false);

    mockRecorder.requestPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    mockRecorder.startRecordingAsync.mockResolvedValue({ success: false, error: "busy" });
    await press("voice-record");
    expect(isRecordingSession()).toBe(false);
  });

  test("leaving the chat mid-recording releases the block", async () => {
    await mount();
    await press("voice-record");
    expect(isRecordingSession()).toBe(true);
    await act(async () => { renderer.unmount(); });
    await flush();
    expect(isRecordingSession()).toBe(false);
  });
});

describe("Phase C: seen messages clear the unread badge", () => {
  test("opening the chat marks it read and clears the badge once the server confirmed", async () => {
    mockMarkRead.mockResolvedValue(true);
    await mount();
    expect(mockMarkRead).toHaveBeenCalledWith(MATCH, ME);
    expect(mockClearUnread).toHaveBeenCalledWith(MATCH);
  });

  test("a failed mark-read does not clear the badge", async () => {
    mockMarkRead.mockResolvedValue(false);
    await mount();
    expect(mockClearUnread).not.toHaveBeenCalled();
  });

  test("a message arriving while the chat is open (voice, photo or text) is marked read and cleared", async () => {
    mockMarkRead.mockResolvedValue(true);
    await mount();
    mockMarkRead.mockClear();
    mockClearUnread.mockClear();
    await act(async () => {
      mockOnReceived!({ id: "v1", matchId: MATCH, sender: THEM, from: "them", text: "Voice message", messageType: "voice", at: 9000, status: "sent", deletedAt: null });
    });
    await flush();
    expect(mockMarkRead).toHaveBeenCalledTimes(1);
    expect(mockClearUnread).toHaveBeenCalledWith(MATCH);

    // My own message is not "unread": nothing to mark.
    mockMarkRead.mockClear();
    await act(async () => {
      mockOnReceived!({ id: "v2", matchId: MATCH, sender: ME, from: "me", text: "hi", messageType: "text", at: 9500, status: "sent", deletedAt: null });
    });
    expect(mockMarkRead).not.toHaveBeenCalled();
  });
});
