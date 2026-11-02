import React from "react";
import { PanResponder } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockLightColors = require("../mobile/src/constants/theme").LightColors;
const mockPush = jest.fn();
const mockSwipeCard = jest.fn();
const mockRefreshDeck = jest.fn().mockResolvedValue(undefined);
const mockAlert = jest.fn();
const mockMilo: any = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  useFocusEffect: () => undefined,
}));
jest.mock("lucide-react-native", () => new Proxy({ __esModule: true }, { get: (t: any, k: string) => (k in t ? t[k] : () => null) }));
jest.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => require("react").createElement("View", null, children),
}));
jest.mock("../mobile/src/context/ThemeContext", () => ({
  useTheme: () => ({ colors: mockLightColors, isDark: false }),
}));
jest.mock("../mobile/src/context/MiloContext", () => ({ useMilo: () => mockMilo }));
jest.mock("../mobile/src/components/discovery/FilterModal", () => ({ FilterModal: () => null }));
jest.mock("../mobile/src/components/discovery/DiscoveryCard", () => ({
  DiscoveryCard: ({ profile, onPressDetails }: any) =>
    require("react").createElement(
      "View",
      { testID: "card" },
      require("react").createElement("View", { testID: "discovery-details-button", onPress: onPressDetails, profileId: profile.id }),
    ),
}));
jest.mock("../mobile/src/services/subscription", () => ({ hasEntitlement: () => true }));
// Sponsored cards (2026-10-30): none running in these tests.
jest.mock("../mobile/src/services/adminContent", () => ({ AD_EVERY_SWIPES: 7, fetchDiscoverAds: () => Promise.resolve([]) }));
jest.mock("../mobile/src/components/discovery/AdCard", () => ({ AdCard: () => null }));
jest.mock("../mobile/src/services/location", () => ({ isLocationSharingEnabled: () => Promise.resolve(false) }));
jest.mock("../mobile/src/services/locationSelection", () => ({ loadLocationSelection: () => Promise.resolve(null) }));
jest.mock("../mobile/src/services/consent", () => ({ ensureConsent: jest.fn(), setConsent: jest.fn() }));
jest.mock("../mobile/src/utils/alert", () => ({ Alert: { alert: (...a: any[]) => mockAlert(...a) } }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DiscoverScreen = require("../mobile/app/(tabs)/discover").default as React.ComponentType;

let tree: TestRenderer.ReactTestRenderer | undefined;

beforeEach(() => {
  mockRefreshDeck.mockClear();
  Object.assign(mockMilo, {
    currentProfile: null,
    deck: [],
    likesRemaining: 10,
    dailyLikeLimit: 50,
    lastPassedId: null,
    filters: { interests: [] },
    loadingDeck: false,
    isBoosting: false,
    boostTimeRemaining: 0,
    subscription: null,
    swipeCard: mockSwipeCard,
    undoPass: jest.fn(),
    triggerBoost: jest.fn(),
    setFilters: jest.fn(),
    refreshDeck: mockRefreshDeck,
    recheckDeck: jest.fn(),
    syncMatches: jest.fn(),
  });
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
});

describe("Discover: empty deck", () => {
  it("offers 'Check again' and pull-to-refresh, both reload the deck", async () => {
    await act(async () => {
      tree = TestRenderer.create(<DiscoverScreen />);
    });
    const button = tree!.root.findAll((n) => n.props?.title === "Check again" && typeof n.props?.onPress === "function")[0]!;
    await act(async () => button.props.onPress());
    expect(mockRefreshDeck).toHaveBeenCalledTimes(1);
    const refresh = tree!.root.findAll((n) => typeof n.props?.onRefresh === "function")[0]!;
    await act(async () => refresh.props.onRefresh());
    expect(mockRefreshDeck).toHaveBeenCalledTimes(2);
  });
});
