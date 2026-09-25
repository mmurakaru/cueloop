import { describe, expect, test } from "bun:test";
import { cueloopOpenApiSpec } from "./openapi-spec";

describe("cueloopOpenApiSpec", () => {
  test("describes every public API operation for function calling", () => {
    const operationIds = new Set<string>();

    for (const pathItem of Object.values(cueloopOpenApiSpec.paths)) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.operationId).toBeString();
        expect(operation.operationId.length).toBeGreaterThan(0);
        expect(operation.description).toBeString();
        expect(operation.description.length).toBeGreaterThan(0);
        expect(operation.responses).toBeTruthy();
        expect(operationIds.has(operation.operationId)).toBeFalse();
        operationIds.add(operation.operationId);
      }
    }

    expect(operationIds.size).toBe(4);
  });

  test("uses OpenAPI 3.1 and typed component schemas", () => {
    expect(cueloopOpenApiSpec.openapi).toBe("3.1.0");
    expect(cueloopOpenApiSpec.components.schemas).toHaveProperty("ApiProblem");
    expect(cueloopOpenApiSpec.components.schemas).toHaveProperty("Product");
    expect(cueloopOpenApiSpec.components.schemas).toHaveProperty("Capabilities");
    expect(cueloopOpenApiSpec.components.schemas).toHaveProperty("Health");
  });
});
