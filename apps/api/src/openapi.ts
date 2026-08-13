/**
 * Minimal but valid OpenAPI 3.1 document for the /v1 surface (spec #77).
 * Generated typed clients should consume this. Kept inline (not yaml+fs) so it
 * is importable without ESM-url resolution. Extend as routes grow.
 */
export const openapi = {
  openapi: "3.1.0",
  info: { title: "PyAI Suite API", version: "0.1.0", license: { name: "MIT" } },
  servers: [{ url: "http://localhost:4000" }],
  paths: {
    "/v1/providers": {
      get: {
        summary: "List registered providers and configured flags",
        responses: { "200": { description: "OK" } },
      },
    },
    "/v1/models": { get: { summary: "List models across configured providers", responses: { "200": { description: "OK" } } } },
    "/v1/capabilities": { get: { summary: "Capability vocabulary", responses: { "200": { description: "OK" } } } },
    "/v1/playground/runs": {
      post: {
        summary: "Run a capability against a provider (universal playground)",
        responses: { "200": { description: "OK" }, "400": { description: "no provider" }, "502": { description: "provider error" } },
      },
    },
    "/v1/calls/analyze": {
      post: {
        summary: "CallIQ sales-call analysis (full workflow)",
        responses: { "200": { description: "analyzed" }, "422": { description: "gate failure" } },
      },
    },
    "/v1/runs/{id}": {
      get: { summary: "Run record + provider-call trace", responses: { "200": { description: "OK" }, "404": { description: "not found" } } },
    },
  },
} as const;

export function openApiJson(): unknown {
  return openapi;
}
