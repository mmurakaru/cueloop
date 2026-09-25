import type { APIRoute } from "astro";
import { cueloopOpenApiSpec } from "../agent/openapi-spec";

export const prerender = true;

export const GET: APIRoute = () =>
  Response.json(cueloopOpenApiSpec, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
