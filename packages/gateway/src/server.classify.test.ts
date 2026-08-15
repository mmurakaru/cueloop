import { describe, expect, test } from "bun:test";
import { isExpectedTransportError } from "./server";

describe(isExpectedTransportError, () => {
  test("recognizes expected transport failures (kept quiet)", () => {
    // Given ssh2 transport-level failures and raw socket resets
    // When each is classified
    // Then it is treated as expected
    expect(isExpectedTransportError({ level: "handshake", message: "Group exchange not implemented for server" })).toBe(true);
    expect(isExpectedTransportError({ level: "authentication" })).toBe(true);
    expect(isExpectedTransportError({ level: "protocol" })).toBe(true);
    expect(isExpectedTransportError({ code: "ECONNRESET" })).toBe(true);
    expect(isExpectedTransportError({ code: "EPIPE" })).toBe(true);
    expect(isExpectedTransportError({ code: "ETIMEDOUT" })).toBe(true);
  });

  test("keeps unexpected and application errors loud", () => {
    // Given an application error or an unknown error shape
    // When each is classified
    // Then it is not treated as expected
    expect(isExpectedTransportError(new Error("upload rejected - blob is not a valid session"))).toBe(false);
    expect(isExpectedTransportError({ level: "something-new" })).toBe(false);
    expect(isExpectedTransportError(null)).toBe(false);
    expect(isExpectedTransportError(undefined)).toBe(false);
  });
});
