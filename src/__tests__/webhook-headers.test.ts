import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWebhookHeadersFromEnv, webhookHeaderNames } from "../webhook-headers.js";

describe("resolveWebhookHeadersFromEnv", () => {
  it("reads both supported headers from named environment variables", () => {
    const headers = resolveWebhookHeadersFromEnv(
      { authorizationEnv: "CURSOR_AUTH", apiKeyEnv: "CURSOR_API_KEY" },
      { CURSOR_AUTH: "Bearer sender-key", CURSOR_API_KEY: "api-key" },
    );

    assert.deepEqual(headers, {
      Authorization: "Bearer sender-key",
      "X-API-Key": "api-key",
    });
    assert.deepEqual(webhookHeaderNames(headers), ["Authorization", "X-API-Key"]);
  });

  it("returns an empty object when clearing headers", () => {
    assert.deepEqual(resolveWebhookHeadersFromEnv({ clearHeaders: true }, {}), {});
  });

  it("fails when the named secret is missing", () => {
    assert.throws(
      () => resolveWebhookHeadersFromEnv({ authorizationEnv: "MISSING" }, {}),
      /Environment variable MISSING is not set/,
    );
  });

  it("rejects clearing and setting headers together", () => {
    assert.throws(
      () => resolveWebhookHeadersFromEnv({ clearHeaders: true, apiKeyEnv: "KEY" }, { KEY: "secret" }),
      /cannot be combined/,
    );
  });
});
