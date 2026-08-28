import { describe, expect, test } from "bun:test";
import { KEY_BYTES, generateMasterKey, openBlob, sealBlob } from "./crypto";

const MASTER = generateMasterKey();
const PLAINTEXT = Buffer.from("a shared plan, compressed", "utf8");

describe("seal then open", () => {
  test("restores the exact plaintext for the same id", () => {
    // Act
    const restored = openBlob(MASTER, "p_abc123xy", sealBlob(MASTER, "p_abc123xy", PLAINTEXT));

    // Assert
    expect(restored.equals(PLAINTEXT)).toBe(true);
  });

  test("draws a fresh nonce per seal, so two seals of the same input differ", () => {
    // Act
    const first = sealBlob(MASTER, "p_abc123xy", PLAINTEXT);
    const second = sealBlob(MASTER, "p_abc123xy", PLAINTEXT);

    // Assert
    expect(first.equals(second)).toBe(false);
  });
});

describe("open fails loudly", () => {
  test("a wrong share id cannot decrypt the blob", () => {
    // Arrange
    const sealed = sealBlob(MASTER, "p_abc123xy", PLAINTEXT);

    // Act / Assert
    expect(() => openBlob(MASTER, "p_wrongidx", sealed)).toThrow();
  });

  test("a wrong master key cannot decrypt the blob", () => {
    // Arrange
    const sealed = sealBlob(MASTER, "p_abc123xy", PLAINTEXT);

    // Act / Assert
    expect(() => openBlob(generateMasterKey(), "p_abc123xy", sealed)).toThrow();
  });

  test("a flipped ciphertext byte fails the auth tag", () => {
    // Arrange
    const sealed = sealBlob(MASTER, "p_abc123xy", PLAINTEXT);
    const envelope = JSON.parse(sealed.toString("utf8")) as { ciphertext: string };
    const bytes = Buffer.from(envelope.ciphertext, "base64");

    bytes[0] = bytes[0]! ^ 0xff;
    envelope.ciphertext = bytes.toString("base64");
    const tampered = Buffer.from(JSON.stringify(envelope), "utf8");

    // Act / Assert
    expect(() => openBlob(MASTER, "p_abc123xy", tampered)).toThrow();
  });
});

describe("generateMasterKey", () => {
  test("returns a 256-bit key", () => {
    // Assert
    expect(generateMasterKey()).toHaveLength(KEY_BYTES);
  });
});
