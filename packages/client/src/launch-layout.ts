/**
 * The pane composition a launch opens with: whether the Threads sidebar is open,
 * what the right region shows, and whether the Changes editor is zoomed. Each
 * command picks a layout through a factory; a bare launch restores the last one
 * the user left (persisted in config), falling back to the default.
 */

export interface LaunchLayout {
  /** The Threads sidebar is open. */
  threads: boolean;
  /** The right region: the Changes editor, the Project tree, or closed. */
  rightSidebar: "changes" | "project" | "off";
  /** The Changes editor is zoomed - the Thread pane hides so the diff fills the middle. */
  zoomChanges: boolean;
}

/** `cueloop diff` / `cueloop review`: the diff front and center. */
export function reviewLayout(): LaunchLayout {
  return { threads: true, rightSidebar: "changes", zoomChanges: true };
}

/** `cueloop plan` / `cueloop reply`: the thread pane fills the middle; no Changes panel. */
export function planLayout(): LaunchLayout {
  return { threads: true, rightSidebar: "off", zoomChanges: false };
}

/** The first-run default, before any layout has been remembered: the inbox with the diff zoomed. */
export function defaultLayout(): LaunchLayout {
  return { threads: true, rightSidebar: "changes", zoomChanges: true };
}

/** Read back the layout the panes currently sit in, to remember it for the next bare launch. */
export function layoutFromPanes(panes: {
  threads: boolean;
  changesOpen: boolean;
  projectOpen: boolean;
  zoomChanges: boolean;
}): LaunchLayout {
  const rightSidebar = panes.changesOpen ? "changes" : panes.projectOpen ? "project" : "off";

  return { threads: panes.threads, rightSidebar, zoomChanges: panes.zoomChanges };
}
