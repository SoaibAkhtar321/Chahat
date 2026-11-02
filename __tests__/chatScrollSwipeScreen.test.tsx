import React from "react";
import { FlatList, PanResponder, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

// The first test loads and transforms the whole chat screen; give a cold Jest cache explicit headroom.
jest.setTimeout(30000);

const ME = "aaaaaaaa-0000-4000-8000-000000000001";
const THEM = "bbbbbbbb-0000-4000-8000-000000000002";
const MATCH = "f6c60000-0000-4000-8000-000000000001";
const MINE_ID = "11111111-1111-4111-8111-111111111111";
const THEIRS_ID = "22222222-2222-4222-8222-222222222222";
const REPLY_ID = "33333333-3333-4333-8333-333333333333";
const LIVE_ID = "44444444-4444-4444-8444-444444444444";
const OLD_ID = "55555555-5555-4555-8555-555555555555";

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
const mockMiloValue = { matches: mockMatches, refreshMatches: (...a: unknown[]) => mockRefresh(...a) };

const mockFetch = jest.fn();
const mockSend = jest.fn();
const mockDelete = jest.fn();
const mockRefresh = jest.fn();
const mockAlert = jest.fn();
const mockMarkRead = jest.fn();
let mockHandlers: any;
let mockOnReceived: ((m: any) => void) | undefined;

const mockFetchReactions = jest.fn(async (..._a: unknown[]): Promise<any[]> => []);
const mockSetReaction = jest.fn(async (..._a: unknown[]): Promise<any> => ({ success: true }));
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
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
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
jest.mock("../mobile/src/services/moderation", () => ({ blockUser: jest.fn(), reportUser: jest.fn(), unmatchUser: jest.fn() }));
jest.mock("../mobile/src/services/voiceMedia", () => ({
  VOICE_LIMITS: { maxDurationMs: 60000 },
  getAudioRecorderAdapter: jest.fn(),
  getAudioPlayerAdapter: () => ({ stopAsync: jest.fn(async () => undefined), pauseAsync: jest.fn(async () => undefined), playAsync: jest.fn() }),
}));
jest.mock("../mobile/src/services/supabase", () => ({
  supabase: { removeChannel: jest.fn(), rpc: jest.fn() },
  isSupabaseConfigured: () => true,
}));
jest.mock("../mobile/src/services/chat", () => ({
  fetchMessagesForMatch: (...a: unknown[]) => mockFetch(...a),
  sendChatMessage: (...a: unknown[]) => mockSend(...a),
  sendVoiceMessage: jest.fn(),
  markChatRead: (...a: unknown[]) => mockMarkRead(...a),
  fetchReactionsForMatch: (...a: unknown[]) => mockFetchReactions(...a),
  setMessageReaction: (...a: unknown[]) => mockSetReaction(...a),
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

const base = { matchId: MATCH, messageType: "text", isViewOnce: false, viewedAt: null, deletedAt: null, status: "sent" };
const MINE = { ...base, id: MINE_ID, sender: ME, from: "me", text: "my own text", at: 1000 };
const THEIRS = { ...base, id: THEIRS_ID, sender: THEM, from: "them", text: "what are you doing tonight?", at: 2000 };
const incoming = (id: string, at: number) => ({ ...base, id, sender: THEM, from: "them", text: "new one", at });

let renderer: TestRenderer.ReactTestRenderer;
let panConfigs: any[] = [];
let createSpy: jest.SpyInstance;

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

async function mount(initial: any[] = [MINE, THEIRS]) {
  mockFetch.mockResolvedValue(initial);
  await act(async () => {
    renderer = TestRenderer.create(<ChatDetailScreen />);
  });
  await flush();
}

const node = (pred: (n: TestRenderer.ReactTestInstance) => boolean) => {
  const found = renderer.root.findAll(pred);
  return found.length ? found[0]! : null;
};
const any = (id: string) => renderer.root.findAll((n) => n.props?.testID === id).length > 0;
const byTestId = (id: string) => node((n) => n.props?.testID === id && typeof n.props.onPress === "function");
const flat = (c: any): string => (Array.isArray(c) ? c.map(flat).join("") : typeof c === "string" || typeof c === "number" ? String(c) : "");
const allText = () => renderer.root.findAllByType(Text).map((t) => flat(t.props.children)).join(" | ");
const press = async (n: TestRenderer.ReactTestInstance | null, label: string) => {
  if (!n) throw new Error(`nothing to press: ${label}`);
  await act(async () => {
    n.props.onPress();
  });
};
const longPress = async (id: string) => {
  const b = node((n) => n.props?.testID === `message-bubble-${id}` && typeof n.props.onLongPress === "function");
  if (!b) throw new Error(`no bubble for ${id}`);
  await act(async () => {
    b.props.onLongPress();
  });
};

// ---- list helpers: the list's own handlers, exactly as React Native would call them ----
const list = () => renderer.root.findByType(FlatList);
const scrollToEnd = () => (list().instance as any).scrollToEnd as jest.Mock;
const VIEWPORT = 600;
const layout = (height: number) => act(() => list().props.onLayout({ nativeEvent: { layout: { height } } }));
const contentSize = (height: number) => act(() => list().props.onContentSizeChange(0, height));
const scrollTo = (offsetY: number, contentHeight: number, viewport = VIEWPORT) =>
  act(() =>
    list().props.onScroll({
      nativeEvent: {
        contentOffset: { x: 0, y: offsetY },
        layoutMeasurement: { width: 360, height: viewport },
        contentSize: { width: 360, height: contentHeight },
      },
    }),
  );
/** A chat that has been laid out (600 high viewport, 2000 content) and sits at the very bottom. */
async function mountAtBottom() {
  await mount();
  (list().instance as any).scrollToEnd = jest.fn();
  await layout(VIEWPORT);
  await contentSize(2000);
  await scrollTo(1400, 2000);
  scrollToEnd().mockClear();
}
/** Same, but the reader scrolled up to the top on purpose. */
async function mountScrolledUp() {
  await mountAtBottom();
  await scrollTo(100, 2000);
  scrollToEnd().mockClear();
}

beforeEach(() => {
  jest.clearAllMocks();
  panConfigs = [];
  const real = PanResponder.create.bind(PanResponder);
  createSpy = jest.spyOn(PanResponder, "create").mockImplementation((c: any) => {
    // Every bubble also creates the voice-seek responder (capture phase); only swipe wrappers count here.
    if (!c.onMoveShouldSetPanResponderCapture) panConfigs.push(c);
    return real(c);
  });
  mockFetchReactions.mockImplementation(async () => []);
  mockSetReaction.mockImplementation(async () => ({ success: true }));
  mockSend.mockImplementation(async (_m: string, _u: string, text: string) => ({
    success: true,
    message: { ...base, id: LIVE_ID, sender: ME, from: "me", text, at: 9000 },
  }));
  mockHandlers = undefined;
  mockOnReceived = undefined;
});

afterEach(async () => {
  createSpy.mockRestore();
  await act(async () => {
    renderer?.unmount();
  });
});

describe("chat screen: swipe to reply", () => {
  it("swiping their message sets the same reply bar as the long-press menu", async () => {
    await mount();
    // One swipe wrapper per bubble, in list order: [MINE, THEIRS].
    expect(panConfigs.length).toBe(2);
    const cfg = panConfigs[1];
    act(() => {
      cfg.onPanResponderGrant({}, { dx: 0, dy: 0 });
      cfg.onPanResponderMove({}, { dx: 70, dy: 2 });
      cfg.onPanResponderRelease({}, { dx: 70, dy: 2 });
    });
    const swipedText = allText();
    expect(any("reply-draft-bar")).toBe(true);
    expect(swipedText).toContain("Replying to Ananya");
    expect(swipedText).toContain("what are you doing tonight?");

    // Cancel, then use the menu: the bar must read exactly the same.
    await press(byTestId("reply-draft-cancel"), "cancel");
    expect(any("reply-draft-bar")).toBe(false);
    await longPress(THEIRS_ID);
    await press(byTestId("message-action-reply"), "reply");
    const menuText = allText();
    expect(menuText).toContain("Replying to Ananya");
    expect(menuText).toContain("what are you doing tonight?");
  });

  it("swiping my own message says You, and the reply is then sent with the link to it", async () => {
    await mount();
    const cfg = panConfigs[0];
    act(() => {
      cfg.onPanResponderGrant({}, { dx: 0, dy: 0 });
      cfg.onPanResponderMove({}, { dx: 70, dy: 0 });
      cfg.onPanResponderRelease({}, { dx: 70, dy: 0 });
    });
    expect(allText()).toContain("Replying to You");
    const input = node((n) => typeof n.props?.placeholder === "string" && n.props.placeholder.startsWith("Type a message") && typeof n.props.onChangeText === "function")!;
    await act(async () => input.props.onChangeText("answering myself"));
    await press(byTestId("chat-send"), "send");
    await flush();
    expect(mockSend).toHaveBeenCalledWith(MATCH, ME, "answering myself", undefined, false, MINE_ID);
  });

  it("a short swipe sets nothing", async () => {
    await mount();
    const cfg = panConfigs[1];
    act(() => {
      cfg.onPanResponderGrant({}, { dx: 0, dy: 0 });
      cfg.onPanResponderMove({}, { dx: 30, dy: 0 });
      cfg.onPanResponderRelease({}, { dx: 30, dy: 0 });
    });
    expect(any("reply-draft-bar")).toBe(false);
  });
});

describe("chat screen: newest message stays visible", () => {
  it("keyboard opens while at the bottom: the list re-anchors to the end", async () => {
    await mountAtBottom();
    await layout(350); // KeyboardAvoidingView shrank the list
    expect(scrollToEnd()).toHaveBeenCalledWith({ animated: false });
  });

  it("keyboard closes while at the bottom: the list re-anchors to the end", async () => {
    await mountAtBottom();
    await layout(350);
    await scrollTo(1650, 2000, 350);
    scrollToEnd().mockClear();
    await layout(VIEWPORT);
    expect(scrollToEnd()).toHaveBeenCalledWith({ animated: false });
  });

  it("keyboard opens while the reader is scrolled up: the list is left alone", async () => {
    await mountScrolledUp();
    await layout(350);
    expect(scrollToEnd()).not.toHaveBeenCalled();
  });

  it("an unchanged height is not a keyboard event", async () => {
    await mountAtBottom();
    await layout(VIEWPORT);
    expect(scrollToEnd()).not.toHaveBeenCalled();
  });

  it("a message that arrives while at the bottom (keyboard open or not) is brought into view, no button", async () => {
    await mountAtBottom();
    await layout(350);
    await scrollTo(1650, 2000, 350);
    scrollToEnd().mockClear();
    await act(async () => mockOnReceived?.(incoming(LIVE_ID, 9000)));
    await contentSize(2090);
    expect(scrollToEnd()).toHaveBeenCalledWith({ animated: false });
    expect(any("chat-jump-to-new")).toBe(false);
  });

  it("a message that arrives while the reader is scrolled up does NOT move the list and offers a jump button", async () => {
    await mountScrolledUp();
    await act(async () => mockOnReceived?.(incoming(LIVE_ID, 9000)));
    await contentSize(2090);
    expect(scrollToEnd()).not.toHaveBeenCalled();
    expect(any("chat-jump-to-new")).toBe(true);
    expect(allText()).toContain("New message");
  });

  it("the jump button counts messages, scrolls to the end, and goes away", async () => {
    await mountScrolledUp();
    await act(async () => mockOnReceived?.(incoming(LIVE_ID, 9000)));
    await contentSize(2090);
    await act(async () => mockOnReceived?.(incoming("77777777-7777-4777-8777-777777777777", 9500)));
    await contentSize(2180);
    expect(allText()).toContain("2 new messages");
    await press(byTestId("chat-jump-to-new"), "jump");
    expect(scrollToEnd()).toHaveBeenCalledWith({ animated: true });
    expect(any("chat-jump-to-new")).toBe(false);
  });

  it("scrolling back to the bottom by hand also clears the button", async () => {
    await mountScrolledUp();
    await act(async () => mockOnReceived?.(incoming(LIVE_ID, 9000)));
    await contentSize(2090);
    expect(any("chat-jump-to-new")).toBe(true);
    await scrollTo(1490, 2090);
    expect(any("chat-jump-to-new")).toBe(false);
  });

  it("a height change with no new message (late photo, reaction) while scrolled up does not yank the list or add a button", async () => {
    await mountScrolledUp();
    await contentSize(2100);
    expect(scrollToEnd()).not.toHaveBeenCalled();
    expect(any("chat-jump-to-new")).toBe(false);
  });

  it("opening the chat lands on the newest message (first layout and content, nothing scrolled yet)", async () => {
    await mount();
    (list().instance as any).scrollToEnd = jest.fn();
    await layout(VIEWPORT);
    await contentSize(1800);
    expect(scrollToEnd()).toHaveBeenCalledWith({ animated: false });
    expect(any("chat-jump-to-new")).toBe(false);
  });
});
