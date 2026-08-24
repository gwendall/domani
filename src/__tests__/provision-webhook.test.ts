import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveProvisionWebhook } from "../provision-webhook.js";

describe("provision webhook authentication", () => {
  it("reads the secret from the named environment variable and redacts previews", () => {
    const config = resolveProvisionWebhook(
      "https://agent.example/inbox",
      { authorizationEnv: "AGENT_AUTH" },
      { AGENT_AUTH: "Bearer sender-secret" },
    );

    assert.deepEqual(config.request, {
      webhook_url: "https://agent.example/inbox",
      webhook_headers: { Authorization: "Bearer sender-secret" },
    });
    assert.deepEqual(config.preview, {
      webhook_url: "https://agent.example/inbox",
      webhook_header_names: ["Authorization"],
    });
    assert.equal(JSON.stringify(config.preview).includes("sender-secret"), false);
  });

  it("requires a webhook URL when an auth environment variable is selected", () => {
    assert.throws(
      () => resolveProvisionWebhook(undefined, { apiKeyEnv: "AGENT_KEY" }, { AGENT_KEY: "secret" }),
      /--webhook is required/,
    );
  });
});
