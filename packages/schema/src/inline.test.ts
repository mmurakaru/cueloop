import { describe, expect, test } from "bun:test";
import { inlineRuns, type InlineRun } from "./inline";

/** Every run concatenated back in order must equal the source (nothing dropped). */
function reconstruct(runs: InlineRun[]): string {
  return runs.map((run) => run.text).join("");
}

/** Each visible run's text must sit at its claimed source offset. */
function offsetsAreExact(source: string, runs: InlineRun[]): boolean {
  return runs.every(
    (run) =>
      run.start === null || source.slice(run.start, run.start + run.text.length) === run.text,
  );
}

/** The visible (non-marker) runs, which are what an anchor can resolve against. */
function visible(runs: InlineRun[]): InlineRun[] {
  return runs.filter((run) => run.start !== null);
}

describe("inlineRuns", () => {
  test("plain text is a single positioned run", () => {
    // Arrange
    const source = "just plain words";

    // Act
    const runs = inlineRuns(source);

    // Assert
    expect(runs).toEqual([{ text: "just plain words", role: "text", start: 0 }]);
  });

  test("strong emphasis: markers concealed, content positioned", () => {
    // Arrange
    const source = "a **bold** b";

    // Act
    const runs = inlineRuns(source);

    // Assert
    expect(runs).toEqual([
      { text: "a ", role: "text", start: 0 },
      { text: "**", role: "marker", start: null },
      { text: "bold", role: "strong", start: 4 },
      { text: "**", role: "marker", start: null },
      { text: " b", role: "text", start: 10 },
    ]);
    expect(reconstruct(runs)).toBe(source);
    expect(offsetsAreExact(source, runs)).toBe(true);
  });

  test("em, code, and strike each conceal their markers and keep offsets", () => {
    // Assert
    for (const [source, role, inner] of [
      ["x *em* y", "em", "em"],
      ["x `code` y", "code", "code"],
      ["x ~~gone~~ y", "strike", "gone"],
    ] as const) {
      const runs = inlineRuns(source);
      const content = runs.find((run) => run.role === role)!;

      expect(content.text).toBe(inner);
      expect(source.slice(content.start!, content.start! + inner.length)).toBe(inner);
      expect(reconstruct(runs)).toBe(source);
      expect(runs.filter((run) => run.role === "marker").every((run) => run.start === null)).toBe(
        true,
      );
    }
  });

  test("code spans do not parse markup inside them", () => {
    // Act
    const runs = inlineRuns("call `a**b**c` now");

    // Assert - the backtick content is one literal code run, no strong inside
    const code = runs.find((run) => run.role === "code")!;

    expect(code.text).toBe("a**b**c");
    expect(runs.some((run) => run.role === "strong")).toBe(false);
  });

  test("links: label positioned with href, brackets and url concealed", () => {
    // Arrange
    const source = "see [the docs](https://example.com) here";

    // Act
    const runs = inlineRuns(source);
    const label = runs.find((run) => run.role === "link")!;

    // Assert
    expect(label).toEqual({
      text: "the docs",
      role: "link",
      start: 5,
      href: "https://example.com",
    });
    expect(reconstruct(runs)).toBe(source);
    // the url text is a concealed marker, never a visible run
    expect(visible(runs).some((run) => run.text.includes("https"))).toBe(false);
  });

  test("links: a destination with balanced parentheses stays whole", () => {
    // Arrange
    const source = "see [foo](https://en.wikipedia.org/wiki/Foo_(bar)) here";

    // Act
    const runs = inlineRuns(source);
    const label = runs.find((run) => run.role === "link")!;

    // Assert
    expect(label.href).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(reconstruct(runs)).toBe(source);
  });

  test("links: an unclosed destination never becomes a link", () => {
    // Arrange
    const source = "see [foo](https://example.com/(open here";

    // Act
    const runs = inlineRuns(source);

    // Assert
    expect(runs.some((run) => run.role === "link")).toBe(false);
    expect(reconstruct(runs)).toBe(source);
  });

  test("nested emphasis: inner marker wins, both markers concealed", () => {
    // Act
    const runs = inlineRuns("**a *b* c**");

    // Assert
    expect(visible(runs)).toEqual([
      { text: "a ", role: "strong", start: 2 },
      { text: "b", role: "em", start: 5 },
      { text: " c", role: "strong", start: 7 },
    ]);
    expect(reconstruct(runs)).toBe("**a *b* c**");
  });

  test("a lone em close is not stolen by an inner ** run", () => {
    // Act - the em must span the whole thing, with **b** strong nested inside
    const runs = inlineRuns("*a **b** c*");

    // Assert
    expect(runs.find((run) => run.role === "em" && run.text === "a ")).toBeDefined();
    expect(runs.find((run) => run.role === "strong" && run.text === "b")).toBeDefined();
    expect(reconstruct(runs)).toBe("*a **b** c*");
  });

  test("unbalanced markers fall back to literal text", () => {
    // Assert
    for (const source of ["**not closed", "a * b", "`open code", "[label](noclose"]) {
      const runs = inlineRuns(source);

      expect(reconstruct(runs)).toBe(source);
      expect(runs.every((run) => run.role === "text" || run.role === "marker")).toBe(true);
      expect(offsetsAreExact(source, runs)).toBe(true);
    }
  });

  test("empty spans do not match", () => {
    // Act
    const runs = inlineRuns("a **** b `` c [](x)");

    // Assert - nothing emphasized; all reconstructs
    expect(reconstruct(runs)).toBe("a **** b `` c [](x)");
    expect(runs.some((run) => ["strong", "em", "code", "link"].includes(run.role))).toBe(false);
  });

  test("backslash escapes render the punctuation literally, marker concealed", () => {
    // Act
    const runs = inlineRuns("not \\*emph\\* here");

    // Assert - no em; the escaped stars are positioned text, backslashes concealed
    expect(runs.some((run) => run.role === "em")).toBe(false);
    expect(reconstruct(runs)).toBe("not \\*emph\\* here");
    expect(offsetsAreExact("not \\*emph\\* here", runs)).toBe(true);
    const star = runs.find((run) => run.text === "*" && run.start !== null)!;

    expect("not \\*emph\\* here"[star.start!]).toBe("*");
  });

  test("reconstruct + exact offsets hold on a mixed line", () => {
    // Arrange
    const source = "The **daemon** persists `sessions` to [disk](d) ~~fast~~";

    // Act
    const runs = inlineRuns(source);

    // Assert
    expect(reconstruct(runs)).toBe(source);
    expect(offsetsAreExact(source, runs)).toBe(true);
  });
});
