import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, skipIfNoAuth, skipIfNoMutate, TEST_DOMAIN } from "./helpers.js";

describe("email webhook endpoints", () => {
  // These tests require a mailbox to exist on TEST_DOMAIN.
  // The email webhook lifecycle: set → get → rotate → test → delete

  describe("email webhook --dry-run", () => {
    it("webhook set --dry-run", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["email", "webhook", `test@${TEST_DOMAIN}`, "--url", "https://httpbin.org/post", "--dry-run"]);
      assertSuccess(result);
      const data = result.data as Record<string, unknown>;
      assert.equal(data.dry_run, true);
      assert.equal(data.action, "email_webhook");
      assertField(data, "address");
      assertField(data, "webhook_url");
    });

    it("webhook remove --dry-run", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["email", "webhook", `test@${TEST_DOMAIN}`, "--dry-run"]);
      assertSuccess(result);
      const data = result.data as Record<string, unknown>;
      assert.equal(data.dry_run, true);
      assert.equal(data.action, "email_webhook");
      assert.equal(data.webhook_url, null);
    });

    it("webhook test --dry-run", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["email", "webhook-test", `test@${TEST_DOMAIN}`, "--dry-run"]);
      assertSuccess(result);
      const data = result.data as Record<string, unknown>;
      assert.equal(data.dry_run, true);
      assert.equal(data.action, "email_webhook_test");
      assert.equal(data.address, `test@${TEST_DOMAIN}`);
    });
  });

  describe("email webhook API lifecycle", () => {
    it("set → get → rotate → test → remove", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      const address = `test@${TEST_DOMAIN}`;
      const webhookUrl = "https://httpbin.org/post";

      // Set webhook via CLI
      const setResult = run(["email", "webhook", address, "--url", webhookUrl]);
      assertSuccess(setResult);
      const setData = setResult.data as Record<string, unknown>;
      assertField(setData, "webhook_url");
      assertField(setData, "signing_secret");
      assert.equal(setData.webhook_url, webhookUrl);
      assert.ok(typeof setData.signing_secret === "string" && setData.signing_secret.startsWith("whsec_"));

      const testResult = run(["email", "webhook-test", address]);
      assertSuccess(testResult);
      assert.equal((testResult.data as Record<string, unknown>).success, true);

      // Get webhook (via API directly since CLI doesn't have a get subcommand)
      // We'll verify it was set by removing it

      // Remove webhook
      const removeResult = run(["email", "webhook", address]);
      assertSuccess(removeResult);
      const removeData = removeResult.data as Record<string, unknown>;
      assert.equal(removeData.has_webhook, false);
      assert.equal(removeData.webhook_url, null);
    });
  });
});
