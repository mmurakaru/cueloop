import { describe, expect, test } from "bun:test";
import { resolveThreadChord } from "./thread-chords";

const owner = { composing: false, isOwner: true, resolved: false };

describe("resolveThreadChord", () => {
  test("ctrl+enter opens the submit overlay for an owner with an open review", () => {
    // Assert: the terminal-safe chord and the cmd forms all submit
    expect(resolveThreadChord({ name: "return", ctrl: true }, owner)).toEqual({
      type: "openSubmit",
    });
    expect(resolveThreadChord({ name: "return", super: true }, owner)).toEqual({
      type: "openSubmit",
    });
    expect(resolveThreadChord({ name: "enter", meta: true }, owner)).toEqual({
      type: "openSubmit",
    });
  });

  test("session chords map to their intents", () => {
    // Assert
    expect(resolveThreadChord({ name: "e", ctrl: true }, owner)).toEqual({ type: "edit" });
    expect(resolveThreadChord({ name: "s", ctrl: true }, owner)).toEqual({ type: "share" });
    expect(resolveThreadChord({ name: "r", ctrl: true }, owner)).toEqual({
      type: "cycleReviewPanel",
    });
  });

  test("option chords drive the rail and curation with the plan sheet's letters", () => {
    // Assert
    expect(resolveThreadChord({ name: "n", meta: true }, owner)).toEqual({
      type: "nextAnnotation",
    });
    expect(resolveThreadChord({ name: "p", meta: true }, owner)).toEqual({
      type: "prevAnnotation",
    });
    expect(resolveThreadChord({ name: "e", meta: true }, owner)).toEqual({ type: "editCard" });
    expect(resolveThreadChord({ name: "backspace", meta: true }, owner)).toEqual({
      type: "removeAnnotation",
    });
    expect(resolveThreadChord({ name: "r", meta: true }, owner)).toEqual({ type: "openRename" });
    expect(resolveThreadChord({ name: "x", meta: true }, owner)).toEqual({ type: "cut" });
    expect(resolveThreadChord({ name: "u", meta: true }, owner)).toEqual({
      type: "restoreCuration",
    });
    expect(resolveThreadChord({ name: "w", meta: true }, owner)).toEqual({
      type: "resizeReviewPanel",
      direction: 1,
    });
    expect(resolveThreadChord({ name: "x", meta: true }, { ...owner, isOwner: false })).toEqual({
      type: "status",
      message: "observer - read-only",
    });
  });

  test("an open composer swallows every chord, so typing is never hijacked", () => {
    // Assert
    expect(
      resolveThreadChord({ name: "return", ctrl: true }, { ...owner, composing: true }),
    ).toBeNull();
    expect(resolveThreadChord({ name: "s", ctrl: true }, { ...owner, composing: true })).toBeNull();
  });

  test("plain keys and unbound chords belong to the document grammar", () => {
    // Assert
    expect(resolveThreadChord({ name: "return" }, owner)).toBeNull();
    expect(resolveThreadChord({ name: "s" }, owner)).toBeNull();
    expect(resolveThreadChord({ name: "x", ctrl: true }, owner)).toBeNull();
  });

  test("a collaborator is told a primitive is read-only, and a resolved review cannot be resubmitted", () => {
    // Assert
    const collaborator = { ...owner, isOwner: false };
    const readOnly = { type: "status" as const, message: "observer - read-only" };

    expect(resolveThreadChord({ name: "return", ctrl: true }, collaborator)).toEqual(readOnly);
    expect(resolveThreadChord({ name: "e", ctrl: true }, collaborator)).toEqual(readOnly);
    expect(resolveThreadChord({ name: "s", ctrl: true }, collaborator)).toEqual(readOnly);
    expect(resolveThreadChord({ name: "r", ctrl: true }, collaborator)).toEqual({
      type: "cycleReviewPanel",
    });
    expect(
      resolveThreadChord({ name: "return", ctrl: true }, { ...owner, resolved: true }),
    ).toBeNull();
  });
});
