import { describe, expect, test } from "bun:test";
import { defaultLayout, layoutFromPanes, planLayout, reviewLayout } from "./launch-layout";

describe("launch layout factories", () => {
  test("review opens the diff zoomed with the Changes panel", () => {
    // Assert
    expect(reviewLayout()).toEqual({ threads: true, rightSidebar: "changes", zoomChanges: true });
  });

  test("plan fills the middle with the thread pane and no right region", () => {
    // Assert
    expect(planLayout()).toEqual({ threads: true, rightSidebar: "off", zoomChanges: false });
  });

  test("the first-run default lands on the inbox with the diff zoomed", () => {
    // Assert
    expect(defaultLayout()).toEqual({ threads: true, rightSidebar: "changes", zoomChanges: true });
  });
});

describe("layoutFromPanes", () => {
  test("the Changes editor wins the right region when open", () => {
    // Assert
    expect(
      layoutFromPanes({ threads: true, changesOpen: true, projectOpen: true, zoomChanges: true }),
    ).toEqual({ threads: true, rightSidebar: "changes", zoomChanges: true });
  });

  test("the Project tree holds the right region when the Changes editor is closed", () => {
    // Assert
    expect(
      layoutFromPanes({
        threads: false,
        changesOpen: false,
        projectOpen: true,
        zoomChanges: false,
      }),
    ).toEqual({ threads: false, rightSidebar: "project", zoomChanges: false });
  });

  test("the right region is off when neither pane is open", () => {
    // Assert
    expect(
      layoutFromPanes({
        threads: true,
        changesOpen: false,
        projectOpen: false,
        zoomChanges: false,
      }),
    ).toEqual({ threads: true, rightSidebar: "off", zoomChanges: false });
  });
});
