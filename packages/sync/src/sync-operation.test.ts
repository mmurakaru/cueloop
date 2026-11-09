import { expect, test } from "bun:test";
import * as v from "valibot";
import { defineSyncOperation, parseSyncOperation } from "./sync-operation.ts";

test("an operation preserves its identity, arguments, and fixed deadline across serialization", () => {
  const definition = defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.object({ body: v.string() }),
  });
  const operation = definition.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "Please explain cancellation" },
    requestLifetimeMilliseconds: 60000,
    now: () => 1700000000000,
  });
  const recovered = definition.parse(JSON.parse(JSON.stringify(operation)));

  expect(recovered.operationIdentifier).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(recovered.operationIdentifier).toBe(operation.operationIdentifier);
  expect(recovered.arguments).toEqual({ body: "Please explain cancellation" });
  expect(recovered.expiresAt).toBe(1700000060000);
});

test.each([
  ["a non-finite number", Infinity],
  ["an undefined value", undefined],
  ["a Date instance", new Date("2026-01-01T00:00:00Z")],
  ["a Map instance", new Map([["body", "text"]])],
])("an untrusted operation rejects %s rather than changing its arguments", (_label, arguments_) => {
  const definition = defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.object({ body: v.string() }),
  });
  const operation = definition.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "Original comment" },
  });

  expect(() => parseSyncOperation({ ...operation, arguments: arguments_ })).toThrow();
});

test("argument normalization is stable when a request is serialized and retried", () => {
  const definition = defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.object({ body: v.pipe(v.string(), v.trim()) }),
  });
  const operation = definition.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "  Explain cleanup  " },
  });
  const recovered = definition.parse(JSON.parse(JSON.stringify(operation)));

  expect(operation.arguments.body).toBe("Explain cleanup");
  expect(recovered.arguments.body).toBe("Explain cleanup");
});

test("a schema cannot change an operation's arguments on every replay", () => {
  const definition = defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.object({
      body: v.pipe(
        v.string(),
        v.transform((body) => `Changed: ${body}`),
      ),
    }),
  });

  expect(() =>
    definition.create({
      workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
      arguments: { body: "Explain cleanup" },
    }),
  ).toThrow(
    "Sync operation arguments must remain unchanged when their schema validates them again",
  );
});

test("a normalized JSON number remains a valid input for its operation schema", () => {
  const definition = defineSyncOperation({
    name: "counter.set",
    version: 1,
    arguments: v.object({ value: v.pipe(v.union([v.string(), v.number()]), v.transform(Number)) }),
  });
  const operation = definition.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { value: "12" },
  });

  expect(operation.arguments.value).toBe(12);
  expect(definition.parse(JSON.parse(JSON.stringify(operation))).arguments.value).toBe(12);
});

void defineSyncOperation({
  name: "counter.set",
  version: 1,
  // @ts-expect-error A numeric result cannot be replayed through a string-only wire schema.
  arguments: v.object({ value: v.pipe(v.string(), v.transform(Number)) }),
});

test("application JSON fields named constructor remain intact during request recovery", () => {
  const definition = defineSyncOperation({
    name: "application.configure",
    version: 1,
    arguments: v.strictObject({ constructor: v.string() }),
  });
  const operation = definition.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { constructor: "TerminalApplication" },
  });
  const recovered = parseSyncOperation(JSON.parse(JSON.stringify(operation)));

  expect(recovered.arguments).toEqual({ constructor: "TerminalApplication" });
});

interface TestCyclicArguments {
  child?: TestCyclicArguments;
}

test("cyclic application input fails validation before it can be submitted", () => {
  const definition = defineSyncOperation({
    name: "comment.add",
    version: 1,
    arguments: v.object({ body: v.string() }),
  });
  const operation = definition.create({
    workspaceIdentifier: "019a6650-0000-7000-8000-000000000001",
    arguments: { body: "Original comment" },
  });
  const cyclic: TestCyclicArguments = {};

  cyclic.child = cyclic;

  expect(() => parseSyncOperation({ ...operation, arguments: cyclic })).toThrow(
    "Sync JSON values require finite, acyclic plain JSON",
  );
});
