import {
  SWIPE_REPLY_MAX_PX,
  SWIPE_REPLY_TRIGGER_PX,
  hasReachedTrigger,
  shouldStartSwipe,
  swipeOffset,
} from "../mobile/src/utils/swipeReply";

describe("swipeReply rules", () => {
  it("takes over only a clear rightward, mostly horizontal move", () => {
    expect(shouldStartSwipe(24, 3)).toBe(true);
    expect(shouldStartSwipe(24, 11)).toBe(true);
  });

  it("leaves vertical scrolling alone", () => {
    expect(shouldStartSwipe(4, 40)).toBe(false);
    expect(shouldStartSwipe(30, 30)).toBe(false);
    expect(shouldStartSwipe(30, 16)).toBe(false);
    expect(shouldStartSwipe(0, 80)).toBe(false);
  });

  it("ignores tiny movements (a tap or the start of a long-press) and leftward moves", () => {
    expect(shouldStartSwipe(6, 0)).toBe(false);
    expect(shouldStartSwipe(10, 0)).toBe(false);
    expect(shouldStartSwipe(-40, 2)).toBe(false);
  });

  it("moves the bubble rightward only and never past the cap", () => {
    expect(swipeOffset(-30)).toBe(0);
    expect(swipeOffset(0)).toBe(0);
    expect(swipeOffset(30)).toBe(30);
    expect(swipeOffset(500)).toBe(SWIPE_REPLY_MAX_PX);
  });

  it("sets the reply only from the trigger distance on", () => {
    expect(hasReachedTrigger(SWIPE_REPLY_TRIGGER_PX - 1)).toBe(false);
    expect(hasReachedTrigger(SWIPE_REPLY_TRIGGER_PX)).toBe(true);
    expect(SWIPE_REPLY_TRIGGER_PX).toBeLessThanOrEqual(SWIPE_REPLY_MAX_PX);
  });
});
