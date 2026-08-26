import { describe, expect, test } from "bun:test";
import { asDaemonRole, roleAllowsMethod } from "./capabilities";

describe("roleAllowsMethod", () => {
  test("the owner may call every verb", () => {
    // Assert
    for (const method of ["session.resolve", "session.submitRevision", "session.delete"])
      expect(roleAllowsMethod("owner", method)).toBe(true);
  });

  test("a capped role may read and annotate but not escalate", () => {
    // Assert - allowed
    for (const method of ["session.get", "session.list", "session.wait", "session.annotate"])
      expect(roleAllowsMethod("agent", method)).toBe(true);
    // Assert - denied
    for (const method of [
      "session.resolve",
      "session.submitRevision",
      "session.setWorkingCopy",
      "session.delete",
      "session.setShareId",
      "session.refreshDiff",
    ])
      expect(roleAllowsMethod("agent", method)).toBe(false);
    expect(roleAllowsMethod("collaborator", "session.resolve")).toBe(false);
  });
});

describe("asDaemonRole", () => {
  test("passes owner and collaborator through and caps anything unknown to agent", () => {
    // Assert
    expect(asDaemonRole("owner")).toBe("owner");
    expect(asDaemonRole("collaborator")).toBe("collaborator");
    expect(asDaemonRole("agent")).toBe("agent");
    expect(asDaemonRole("root")).toBe("agent");
    expect(asDaemonRole(undefined)).toBe("agent");
  });
});
