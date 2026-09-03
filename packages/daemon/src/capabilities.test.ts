import { describe, expect, test } from "bun:test";
import { asDaemonRole, DEFAULT_ROLE, roleAllowsMethod } from "./capabilities";
import type { MethodName } from "./validate";

describe("roleAllowsMethod", () => {
  test("the owner may call every primitive", () => {
    // Assert
    const owned: MethodName[] = ["session.resolve", "session.submitRevision", "session.delete"];

    for (const method of owned) expect(roleAllowsMethod("owner", method)).toBe(true);
  });

  test("a capped role may read and annotate but not escalate", () => {
    // Assert - allowed
    const open: MethodName[] = ["session.get", "session.list", "session.wait", "session.annotate"];

    for (const method of open) expect(roleAllowsMethod("agent", method)).toBe(true);
    // Assert - denied
    const owned: MethodName[] = [
      "session.resolve",
      "session.submitRevision",
      "session.setWorkingCopy",
      "session.delete",
      "session.setShareId",
      "session.refreshDiff",
      "session.removeAnnotation",
      "session.create",
    ];

    for (const method of owned) expect(roleAllowsMethod("agent", method)).toBe(false);
    expect(roleAllowsMethod("collaborator", "session.resolve")).toBe(false);
  });

  test("a connection starts as a collaborator, never as the owner", () => {
    // Assert
    expect(DEFAULT_ROLE).toBe("collaborator");
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
