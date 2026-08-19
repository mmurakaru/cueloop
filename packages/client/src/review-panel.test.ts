import { describe, expect, test } from "bun:test";
import {
  REVIEW_DEFAULT_WIDTH,
  REVIEW_MAX_WIDTH,
  REVIEW_MIN_WIDTH,
  REVIEW_PLAN_MIN_WIDTH,
  REVIEW_RESIZE_STEP,
  clampWidth,
  cycleReviewPanelMode,
  maxWidthForTerminal,
  resolveReviewWidth,
  reviewRowsToDivider,
  toggleReviewPanelMode,
  widthFromMouseColumn,
} from "./review-panel";

describe("clampWidth", () => {
  test("keeps a width inside the bounds untouched", () => {
    expect(clampWidth(REVIEW_DEFAULT_WIDTH)).toBe(REVIEW_DEFAULT_WIDTH);
  });

  test("clamps below the minimum and above the maximum", () => {
    expect(clampWidth(REVIEW_MIN_WIDTH - 10)).toBe(REVIEW_MIN_WIDTH);
    expect(clampWidth(REVIEW_MAX_WIDTH + 10)).toBe(REVIEW_MAX_WIDTH);
  });

  test("rounds a fractional column to a whole one", () => {
    expect(clampWidth(30.7)).toBe(31);
  });

  test("honors explicit bounds", () => {
    expect(clampWidth(100, 10, 20)).toBe(20);
    expect(clampWidth(5, 10, 20)).toBe(10);
  });
});

describe("cycleReviewPanelMode", () => {
  test("cycles expanded -> compact -> hidden -> expanded", () => {
    expect(cycleReviewPanelMode("expanded")).toBe("compact");
    expect(cycleReviewPanelMode("compact")).toBe("hidden");
    expect(cycleReviewPanelMode("hidden")).toBe("expanded");
  });
});

describe("toggleReviewPanelMode", () => {
  test("the chevron toggles only between expanded and compact, never hidden", () => {
    expect(toggleReviewPanelMode("expanded")).toBe("compact");
    expect(toggleReviewPanelMode("compact")).toBe("expanded");
    // a hidden panel has no chevron; a stray toggle still opens it
    expect(toggleReviewPanelMode("hidden")).toBe("expanded");
  });
});

describe("widthFromMouseColumn", () => {
  test("measures the rail from the mouse column to the right edge", () => {
    // divider dragged to column 80 of a 120-wide terminal -> a 40-col rail
    expect(widthFromMouseColumn(80, 120)).toBe(40);
  });

  test("clamps the dragged width to the bounds", () => {
    expect(widthFromMouseColumn(0, 120)).toBe(REVIEW_MAX_WIDTH);
    expect(widthFromMouseColumn(119, 120)).toBe(REVIEW_MIN_WIDTH);
  });

  test("cannot drag the rail wide enough to starve the plan on a narrow terminal", () => {
    // dragging to the far left edge of a 60-col terminal still leaves the plan its minimum
    expect(widthFromMouseColumn(0, 60)).toBe(60 - REVIEW_PLAN_MIN_WIDTH - 1);
  });

  test("the resize step widens and narrows within the clamp", () => {
    expect(clampWidth(REVIEW_DEFAULT_WIDTH + REVIEW_RESIZE_STEP)).toBe(
      REVIEW_DEFAULT_WIDTH + REVIEW_RESIZE_STEP,
    );
    expect(clampWidth(REVIEW_MIN_WIDTH - REVIEW_RESIZE_STEP)).toBe(REVIEW_MIN_WIDTH);
  });
});

describe("maxWidthForTerminal", () => {
  test("allows the full rail on a wide terminal", () => {
    expect(maxWidthForTerminal(120)).toBe(REVIEW_MAX_WIDTH);
  });

  test("reserves the plan its minimum on a narrow terminal", () => {
    // 60-col terminal: 30 for the plan and 1 for the divider leaves 29 for the rail
    expect(maxWidthForTerminal(60)).toBe(60 - REVIEW_PLAN_MIN_WIDTH - 1);
  });

  test("never drops below the rail minimum, however narrow the terminal", () => {
    expect(maxWidthForTerminal(40)).toBe(REVIEW_MIN_WIDTH);
  });
});

describe("resolveReviewWidth", () => {
  test("leaves a width that already fits untouched", () => {
    expect(resolveReviewWidth(REVIEW_DEFAULT_WIDTH, 120)).toBe(REVIEW_DEFAULT_WIDTH);
  });

  test("shrinks a wide persisted width so the plan keeps its room", () => {
    // a saved 50-col rail on a 60-col terminal would leave the plan 9 cols; clamp it back
    expect(resolveReviewWidth(REVIEW_MAX_WIDTH, 60)).toBe(60 - REVIEW_PLAN_MIN_WIDTH - 1);
  });
});

describe("reviewRowsToDivider", () => {
  test("builds one vertical glyph per row", () => {
    expect(reviewRowsToDivider(3)).toBe("│\n│\n│");
  });

  test("never collapses to an empty column", () => {
    expect(reviewRowsToDivider(0)).toBe("│");
    expect(reviewRowsToDivider(-4)).toBe("│");
  });
});
