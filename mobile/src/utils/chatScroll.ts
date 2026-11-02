/**
 * Pure helpers that decide when the chat list should follow new content to the bottom.
 * No React, no native calls: everything here is unit-testable.
 *
 * Rules (see app/chat/[id].tsx):
 *  - If the reader is at (or near) the bottom, new content and a shrinking viewport (keyboard opening) keep the newest
 *    message visible.
 *  - If the reader scrolled up on purpose, the list is NOT moved. A message of mine still scrolls to the bottom (I just
 *    sent it); an incoming message only raises the "new message" jump button.
 */

/** How far from the very bottom still counts as "at the bottom" (about one short line of text). */
export const NEAR_BOTTOM_PX = 80;

export interface ScrollMetrics {
  /** contentOffset.y of the list */
  offsetY: number;
  /** Visible height of the list */
  viewportHeight: number;
  /** Total height of the content */
  contentHeight: number;
}

/** Distance in pixels between the visible bottom edge and the end of the content (never negative). */
export function distanceFromBottom(m: ScrollMetrics): number {
  return Math.max(0, m.contentHeight - m.offsetY - m.viewportHeight);
}

export function isNearBottom(m: ScrollMetrics, threshold: number = NEAR_BOTTOM_PX): boolean {
  return distanceFromBottom(m) <= threshold;
}

/** Offset that puts the end of the content at the bottom of the viewport. */
export function bottomOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, contentHeight - viewportHeight);
}

export type ContentChangeAction = "scroll" | "badge" | "none";

export interface ContentChange {
  /** Was the reader at the bottom before the content changed? */
  wasNearBottom: boolean;
  /** Is there a different newest message than before (a new one was appended)? */
  newestChanged: boolean;
  /** Is the newest message mine? */
  newestFromMe: boolean;
}

/** What to do when the content height of the list changes. */
export function actionOnContentChange(c: ContentChange): ContentChangeAction {
  if (c.wasNearBottom) return "scroll";
  if (c.newestChanged && c.newestFromMe) return "scroll";
  if (c.newestChanged && !c.newestFromMe) return "badge";
  return "none";
}

/** What to do when the visible height of the list changes (keyboard opens or closes). */
export function actionOnViewportChange(wasNearBottom: boolean): "scroll" | "none" {
  return wasNearBottom ? "scroll" : "none";
}
