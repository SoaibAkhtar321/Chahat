import {
  NEAR_BOTTOM_PX,
  actionOnContentChange,
  actionOnViewportChange,
  bottomOffset,
  distanceFromBottom,
  isNearBottom,
} from "../mobile/src/utils/chatScroll";

const m = (offsetY: number, viewportHeight = 600, contentHeight = 2000) => ({ offsetY, viewportHeight, contentHeight });

describe("chatScroll: where the reader is", () => {
  it("measures the distance between the visible bottom edge and the end of the content", () => {
    expect(distanceFromBottom(m(1400))).toBe(0);
    expect(distanceFromBottom(m(1000))).toBe(400);
  });

  it("never reports a negative distance (overscroll, short content)", () => {
    expect(distanceFromBottom(m(1500))).toBe(0);
    expect(distanceFromBottom({ offsetY: 0, viewportHeight: 600, contentHeight: 200 })).toBe(0);
  });

  it("counts the last few pixels as 'at the bottom', but not a deliberate scroll up", () => {
    expect(isNearBottom(m(1400 - NEAR_BOTTOM_PX))).toBe(true);
    expect(isNearBottom(m(1400 - NEAR_BOTTOM_PX - 1))).toBe(false);
    expect(isNearBottom(m(0))).toBe(false);
  });

  it("an empty list that is about to receive its first messages counts as at the bottom", () => {
    expect(isNearBottom({ offsetY: 0, viewportHeight: 0, contentHeight: 0 })).toBe(true);
  });

  it("bottomOffset puts the end of the content at the bottom of the viewport", () => {
    expect(bottomOffset(2000, 600)).toBe(1400);
    expect(bottomOffset(300, 600)).toBe(0);
  });
});

describe("chatScroll: content grew (a message arrived or was sent)", () => {
  it("follows when the reader was at the bottom, for incoming and outgoing", () => {
    expect(actionOnContentChange({ wasNearBottom: true, newestChanged: true, newestFromMe: false })).toBe("scroll");
    expect(actionOnContentChange({ wasNearBottom: true, newestChanged: true, newestFromMe: true })).toBe("scroll");
  });

  it("keeps following when only the height changed (photo loaded, quote measured) and the reader was at the bottom", () => {
    expect(actionOnContentChange({ wasNearBottom: true, newestChanged: false, newestFromMe: false })).toBe("scroll");
  });

  it("scrolled up: an incoming message does NOT move the list, it only raises the jump button", () => {
    expect(actionOnContentChange({ wasNearBottom: false, newestChanged: true, newestFromMe: false })).toBe("badge");
  });

  it("scrolled up: my own new message still goes to the bottom", () => {
    expect(actionOnContentChange({ wasNearBottom: false, newestChanged: true, newestFromMe: true })).toBe("scroll");
  });

  it("scrolled up: a height change without a new message (reaction, deletion, late photo) leaves the list alone", () => {
    expect(actionOnContentChange({ wasNearBottom: false, newestChanged: false, newestFromMe: false })).toBe("none");
    expect(actionOnContentChange({ wasNearBottom: false, newestChanged: false, newestFromMe: true })).toBe("none");
  });
});

describe("chatScroll: the visible area changed (keyboard)", () => {
  it("re-anchors to the bottom only if the reader was at the bottom", () => {
    expect(actionOnViewportChange(true)).toBe("scroll");
    expect(actionOnViewportChange(false)).toBe("none");
  });
});
