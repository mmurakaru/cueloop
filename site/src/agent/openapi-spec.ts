const jsonContent = <const Schema extends object>(schema: Schema) => ({
  "application/json": { schema },
});

const problemContent = <const Schema extends object>(schema: Schema) => ({
  "application/problem+json": { schema },
});

const problemResponse = {
  description: "The request could not be completed.",
  content: problemContent({ $ref: "#/components/schemas/ApiProblem" }),
} as const;

/** OpenAPI 3.1 contract for the read-only cueloop discovery API. */
export const cueloopOpenApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "cueloop public discovery API",
    version: "1.0.0",
    description:
      "Read-only product metadata for agents and developer tools. Review operations run through the cueloop CLI and coding-agent integrations.",
    license: {
      name: "Apache-2.0",
      identifier: "Apache-2.0",
    },
  },
  servers: [{ url: "https://www.cueloop.dev", description: "Production" }],
  externalDocs: {
    description: "cueloop documentation",
    url: "https://www.cueloop.dev/docs/",
  },
  paths: {
    "/api/v1": {
      get: {
        operationId: "getCueloopApiIndex",
        summary: "List public discovery endpoints",
        description: "Returns links to cueloop product, capability, health, and OpenAPI resources.",
        responses: {
          "200": {
            description: "The public API index.",
            content: jsonContent({ $ref: "#/components/schemas/ApiIndex" }),
          },
          "405": problemResponse,
        },
      },
    },
    "/api/v1/product": {
      get: {
        operationId: "getCueloopProduct",
        summary: "Describe cueloop",
        description:
          "Returns canonical product, documentation, repository, and CLI installation links.",
        responses: {
          "200": {
            description: "The cueloop product record.",
            content: jsonContent({ $ref: "#/components/schemas/Product" }),
          },
          "405": problemResponse,
        },
      },
    },
    "/api/v1/capabilities": {
      get: {
        operationId: "getCueloopCapabilities",
        summary: "List cueloop capabilities",
        description:
          "Returns supported review workflows, review actions, integrations, and collaboration protocol.",
        responses: {
          "200": {
            description: "The supported cueloop capabilities.",
            content: jsonContent({ $ref: "#/components/schemas/Capabilities" }),
          },
          "405": problemResponse,
        },
      },
    },
    "/api/v1/health": {
      get: {
        operationId: "getCueloopApiHealth",
        summary: "Check discovery API health",
        description: "Returns the availability and version of the public discovery API.",
        responses: {
          "200": {
            description: "The discovery API is available.",
            content: jsonContent({ $ref: "#/components/schemas/Health" }),
          },
          "405": problemResponse,
        },
      },
    },
  },
  components: {
    schemas: {
      ApiIndex: {
        type: "object",
        additionalProperties: false,
        required: ["name", "version", "endpoints"],
        properties: {
          name: { type: "string" },
          version: { type: "string" },
          endpoints: {
            type: "object",
            additionalProperties: { type: "string", format: "uri" },
          },
        },
      },
      Product: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "description",
          "category",
          "homepage",
          "documentation",
          "repository",
          "cli",
        ],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["developer_tool"] },
          homepage: { type: "string", format: "uri" },
          documentation: { type: "string", format: "uri" },
          repository: { type: "string", format: "uri" },
          cli: {
            type: "object",
            required: ["install", "package"],
            properties: {
              install: { type: "string" },
              package: { type: "string", format: "uri" },
            },
          },
        },
      },
      Capabilities: {
        type: "object",
        additionalProperties: false,
        required: ["workflows", "reviewActions", "integrations", "collaboration"],
        properties: {
          workflows: { type: "array", items: { type: "string" } },
          reviewActions: { type: "array", items: { type: "string" } },
          integrations: { type: "array", items: { type: "string" } },
          collaboration: {
            type: "object",
            required: ["protocol", "documentation"],
            properties: {
              protocol: { type: "string", enum: ["SSH"] },
              documentation: { type: "string", format: "uri" },
            },
          },
        },
      },
      Health: {
        type: "object",
        additionalProperties: false,
        required: ["status", "service", "version"],
        properties: {
          status: { type: "string", enum: ["operational"] },
          service: { type: "string" },
          version: { type: "string" },
        },
      },
      ApiProblem: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "status", "detail", "code", "resolution", "instance"],
        properties: {
          type: { type: "string", format: "uri" },
          title: { type: "string" },
          status: { type: "integer", minimum: 400, maximum: 599 },
          detail: { type: "string" },
          code: { type: "string" },
          resolution: { type: "string" },
          instance: { type: "string" },
        },
      },
    },
  },
} as const;
