import { describe, expect, test } from "bun:test";
import { clipboardCommands } from "./clipboard";

describe(clipboardCommands, () => {
  test("uses pbcopy on macOS", () => {
    // Assert
    expect(clipboardCommands("darwin")).toEqual([["pbcopy"]]);
  });

  test("uses clip.exe on Windows", () => {
    // Assert
    expect(clipboardCommands("win32")).toEqual([["clip.exe"]]);
  });

  test("prefers wayland, then X11 tools on Linux", () => {
    // Act
    const commands = clipboardCommands("linux");

    // Assert
    expect(commands[0]).toEqual(["wl-copy"]);
    expect(commands.map((command) => command[0])).toEqual(["wl-copy", "xclip", "xsel"]);
  });
});
