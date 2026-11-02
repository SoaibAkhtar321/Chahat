/**
 * Pure rules for the swipe-to-reply gesture on a chat bubble. No React, no native calls.
 */

/** Finger travel (px) at which releasing sets the reply. */
export const SWIPE_REPLY_TRIGGER_PX = 56;
/** The bubble never follows the finger further than this. */
export const SWIPE_REPLY_MAX_PX = 80;
/** Horizontal travel before the gesture is considered at all. */
const SWIPE_START_PX = 10;
/** The move must be at least this many times wider than tall, so vertical scrolling is never taken over. */
const HORIZONTAL_DOMINANCE = 2;

/** Should the swipe take over the touch? Only a clear, rightward, mostly horizontal move. */
export function shouldStartSwipe(dx: number, dy: number): boolean {
  return dx > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_DOMINANCE;
}

/** How far the bubble is shifted for a given finger travel: rightward only, eased and capped. */
export function swipeOffset(dx: number): number {
  if (dx <= 0) return 0;
  return Math.min(dx, SWIPE_REPLY_MAX_PX);
}

/** Has the finger travelled far enough that releasing now sets the reply? */
export function hasReachedTrigger(dx: number): boolean {
  return dx >= SWIPE_REPLY_TRIGGER_PX;
}
