import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_CONSENT_VERSION, AssistantUsageError, buildAssistantRequest } from "../commands/assistant.js";

describe("domani assistant request planning", () => {
  it("reads settings with a plain GET", () => {
    assert.deepEqual(buildAssistantRequest("settings", undefined, {}), { method: "GET", path: "/api/assistant/settings" });
    assert.deepEqual(buildAssistantRequest(undefined, undefined, {}), { method: "GET", path: "/api/assistant/today" });
  });

  it("maps --mailboxes to a mailbox_ids array and --none to an empty scope", () => {
    const request = buildAssistantRequest("set", undefined, { mailboxes: "mbx_1, mbx_2,,mbx_3", enable: true, shadow: false, days: "14" });
    assert.equal(request.method, "PUT");
    assert.equal(request.path, "/api/assistant/settings");
    assert.deepEqual(request.body, { enabled: true, shadow_enabled: false, mailbox_ids: ["mbx_1", "mbx_2", "mbx_3"], history_window_days: 14 });

    assert.deepEqual(buildAssistantRequest("set", undefined, { none: true }).body, { mailbox_ids: [] });
    assert.throws(() => buildAssistantRequest("set", undefined, {}), (error: unknown) => error instanceof AssistantUsageError && /at least one setting/.test(error.message));
    assert.throws(() => buildAssistantRequest("set", undefined, { attachmentVision: "maybe" }), /on or off/);
  });

  it("refuses to start a preview without explicit consent", () => {
    assert.throws(
      () => buildAssistantRequest("preview", undefined, { mailboxes: "mbx_1" }),
      (error: unknown) => error instanceof AssistantUsageError && error.message === "--consent is required to start the assistant" && /Nothing is ever sent on your behalf/.test(error.hint || ""),
    );
    const request = buildAssistantRequest("preview", undefined, { mailboxes: "mbx_1", consent: true });
    assert.deepEqual(request, {
      method: "POST",
      path: "/api/assistant/preview",
      body: { mailbox_ids: ["mbx_1"], history_window_days: 30, consent: true, consent_version: ASSISTANT_CONSENT_VERSION },
    });
  });

  it("records a fenced choose interaction with a persisted idempotency operation", () => {
    const request = buildAssistantRequest("choose", "wi_789", { itemVersion: "3", decision: "dec_1", decisionVersion: "1", option: "opt_send" });
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/api/assistant/work-items/wi_789/interactions");
    assert.deepEqual(request.body, { type: "choose", work_item_version: 3, decision_id: "dec_1", decision_version: 1, option_id: "opt_send" });
    assert.equal(request.idempotency, "assistant:choose:wi_789");

    assert.throws(() => buildAssistantRequest("choose", "wi_789", { itemVersion: "3" }), /--option, --decision and --decision-version are required/);
    assert.throws(() => buildAssistantRequest("choose", undefined, { itemVersion: "3" }), /Work item ID is required/);
    assert.equal(buildAssistantRequest("take-over", "wi_789", { itemVersion: "2" }).body?.type, "take_over");
    assert.deepEqual(buildAssistantRequest("snooze", "wi_789", { itemVersion: "2", until: "2026-09-03T09:00:00Z" }).body, { type: "snooze", work_item_version: 2, until: "2026-09-03T09:00:00Z" });
  });

  it("requires --yes before deleting derived data and never touches source mail", () => {
    assert.throws(
      () => buildAssistantRequest("delete", undefined, {}),
      (error: unknown) => error instanceof AssistantUsageError && /requires --yes/.test(error.message) && /Source mail is never touched/.test(error.hint || ""),
    );
    assert.deepEqual(buildAssistantRequest("delete", undefined, { yes: true }), { method: "DELETE", path: "/api/assistant/data" });
  });

  it("rejects unknown actions with the action list", () => {
    assert.throws(() => buildAssistantRequest("send", undefined, {}), /Unknown action: send/);
  });
});
