import { useCallback, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

/** How often the focused, empty Discover screen asks "is it time to look again?". The real spacing is the back-off in recheckDeck. */
export const EMPTY_DECK_TICK_MS = 15_000;

interface Options {
  deckEmpty: boolean;
  recheckDeck: (force?: boolean) => Promise<void>;
  syncMatches: () => Promise<void>;
}

/**
 * While Discover is on screen: on focus, check for new matches (ids only) and look again if the deck is empty; while
 * the deck stays empty, keep looking on a slow timer (spaced by the back-off inside recheckDeck). The timer stops when
 * the screen loses focus, and ticks do nothing while the app is in the background.
 */
export function useDiscoverLiveSync(options: Options): void {
  const ref = useRef(options);
  ref.current = options;

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      void ref.current.syncMatches();
      void ref.current.recheckDeck(false);
      const tick = () => {
        timer = setTimeout(async () => {
          if (cancelled) return;
          if (AppState.currentState === "active" && ref.current.deckEmpty) {
            try {
              await ref.current.recheckDeck(false);
            } catch {
              /* a failed look is retried at the next tick */
            }
          }
          if (!cancelled) tick();
        }, EMPTY_DECK_TICK_MS);
      };
      tick();
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }, []),
  );
}
