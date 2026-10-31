const mockSetChannel = jest.fn(async () => undefined);
const mockSchedule = jest.fn(async () => "id");
const mockDismiss = jest.fn(async () => undefined);
let mockOs = "android";

jest.mock("react-native", () => ({ Platform: { get OS() { return mockOs; } } }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  setNotificationChannelAsync: (...a: unknown[]) => mockSetChannel(...(a as [])),
  scheduleNotificationAsync: (...a: unknown[]) => mockSchedule(...(a as [])),
  dismissNotificationAsync: (...a: unknown[]) => mockDismiss(...(a as [])),
}));

import {
  dismissOngoingCallNotification,
  showOngoingCallNotification,
} from "../mobile/src/services/ongoingCallNotification";

beforeEach(() => {
  jest.clearAllMocks();
  mockOs = "android";
});

describe("ongoing call notification", () => {
  it("posts one silent, sticky notification carrying the call ids", async () => {
    await showOngoingCallNotification({ callId: "c1", matchId: "m1", partnerName: "Asha" });
    expect(mockSetChannel).toHaveBeenCalledWith("ongoing_call", expect.objectContaining({ sound: null, importance: 2 }));
    const arg = (mockSchedule.mock.calls[0] as unknown[])[0] as any;
    expect(arg.identifier).toBe("chahat-ongoing-call");
    expect(arg.content.sticky).toBe(true);
    expect(arg.content.data).toEqual({ category: "ongoing_call", callId: "c1", matchId: "m1" });
    expect(arg.trigger).toEqual({ channelId: "ongoing_call" });
  });

  it("never throws when notifications are unavailable", async () => {
    mockSchedule.mockRejectedValueOnce(new Error("denied"));
    await expect(showOngoingCallNotification({ callId: "c1", matchId: "m1" })).resolves.toBeUndefined();
    mockDismiss.mockRejectedValueOnce(new Error("gone"));
    await expect(dismissOngoingCallNotification()).resolves.toBeUndefined();
  });

  it("dismisses by its fixed id and does nothing off Android", async () => {
    await dismissOngoingCallNotification();
    expect(mockDismiss).toHaveBeenCalledWith("chahat-ongoing-call");
    mockOs = "ios";
    jest.clearAllMocks();
    await showOngoingCallNotification({ callId: "c1", matchId: "m1" });
    await dismissOngoingCallNotification();
    expect(mockSchedule).not.toHaveBeenCalled();
    expect(mockDismiss).not.toHaveBeenCalled();
  });
});
