import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, assertArray, skipIfNoAuth, skipIfNoMutate, testId } from "./helpers.js";

describe("webhooks workflow", () => {
  describe("events (read-only)", () => {
    it("lists webhook event types", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["webhooks", "events"]);
      assertSuccess(result);
      assertField(result.data, "events");
      const events = assertArray(result.data, "events");
      assert.ok(events.length > 0, "Expected at least one event type");
      assertField(events[0], "type");
      assertField(events[0], "description");
    });
  });

  describe("webhooks list (read-only)", () => {
    it("lists webhooks", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["webhooks", "list"]);
      assertSuccess(result);
      assertField(result.data, "webhooks");
      assertArray(result.data, "webhooks");
    });
  });

  describe("webhooks CRUD lifecycle", () => {
    it("create → list → update → deliveries → delete", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      const id = testId();
      const url = `https://httpbin.org/post?test=${id}`;

      // Create
      const createResult = run(["webhooks", "create", "--url", url, "--events", "domain.purchased,dns.updated"]);
      assertSuccess(createResult);
      const created = createResult.data as Record<string, unknown>;
      assertField(created, "id");
      assertField(created, "secret");
      assert.equal(created.url, url);
      const webhookId = created.id as string;

      // Verify in list
      const listResult = run(["webhooks", "list"]);
      assertSuccess(listResult);
      const webhooks = assertArray(listResult.data, "webhooks") as Array<{ id: string }>;
      assert.ok(webhooks.some((w) => w.id === webhookId), "Webhook should appear in list");

      // Update: pause
      const updateResult = run(["webhooks", "update", "--webhook-id", webhookId, "--active", "off"]);
      assertSuccess(updateResult);
      assert.equal((updateResult.data as Record<string, unknown>).active, false);

      // Deliveries
      const deliveriesResult = run(["webhooks", "deliveries", "--webhook-id", webhookId]);
      assertSuccess(deliveriesResult);
      assertArray(deliveriesResult.data, "deliveries");

      // Delete (cleanup)
      const deleteResult = run(["webhooks", "delete", "--webhook-id", webhookId]);
      assertSuccess(deleteResult);

      // Verify removed
      const afterResult = run(["webhooks", "list"]);
      assertSuccess(afterResult);
      const after = assertArray(afterResult.data, "webhooks") as Array<{ id: string }>;
      assert.ok(!after.some((w) => w.id === webhookId), "Webhook should be removed");
    });
  });
});
