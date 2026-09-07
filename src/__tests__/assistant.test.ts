import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ASSISTANT_CONSENT_VERSION, AssistantUsageError, buildAssistantRequest } from "../commands/assistant.js";

describe("domani assistant request planning", () => {
  it("reads the rules, the approvals, the suggestions and the metrics with a plain GET", () => {
    assert.deepEqual(buildAssistantRequest("rules", undefined, {}), { method: "GET", path: "/api/assistant/rules" });
    assert.deepEqual(buildAssistantRequest("approvals", undefined, {}), { method: "GET", path: "/api/assistant/approvals" });
    assert.deepEqual(buildAssistantRequest("suggestions", undefined, {}), { method: "GET", path: "/api/assistant/suggestions" });
    assert.deepEqual(buildAssistantRequest("metrics", undefined, {}), { method: "GET", path: "/api/assistant/metrics" });
    assert.deepEqual(buildAssistantRequest("metrics", undefined, { days: "7" }), { method: "GET", path: "/api/assistant/metrics?window_days=7" });
  });

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

describe("domani assistant brief and facts", () => {
  it("reads the brief of a work item or of a correspondent", () => {
    assert.deepEqual(buildAssistantRequest("brief", "wi_1", {}), { method: "GET", path: "/api/assistant/work-items/wi_1/brief" });
    assert.deepEqual(buildAssistantRequest("brief", undefined, { correspondent: "ada@example.com", mailbox: "hi@myapp.dev" }), { method: "GET", path: "/api/assistant/brief?correspondent=ada%40example.com&mailbox=hi%40myapp.dev" });
    assert.throws(() => buildAssistantRequest("brief", undefined, {}), (error: unknown) => error instanceof AssistantUsageError && /correspondent/.test(error.message));
    assert.deepEqual(buildAssistantRequest("facts", "wi_1", {}), { method: "GET", path: "/api/assistant/work-items/wi_1/facts" });
  });
});

describe("domani assistant tasks", () => {
  it("reads the envelope, holds and releases the lease", () => {
    assert.deepEqual(buildAssistantRequest("task", "wi_1", {}), { method: "GET", path: "/api/assistant/tasks/wi_1" });
    assert.deepEqual(buildAssistantRequest("lease", "wi_1", { ttl: "120" }), { method: "POST", path: "/api/assistant/tasks/wi_1/lease", body: { ttl_seconds: 120 } });
    assert.throws(() => buildAssistantRequest("lease", "wi_1", { ttl: "5" }), /--ttl must be an integer of at least 30/);
    assert.deepEqual(buildAssistantRequest("release", "wi_1", {}), { method: "DELETE", path: "/api/assistant/tasks/wi_1/lease" });
    assert.throws(() => buildAssistantRequest("task", undefined, {}), /Task ID is required/);
  });

  it("asks for effects as a JSON array with a persisted idempotency operation", () => {
    const request = buildAssistantRequest("effects", "wi_1", { effects: '[{"kind":"label","mailbox_id":"mbx_1","add":["finance"]}]', text: "filing" });
    assert.equal(request.method, "POST");
    assert.equal(request.path, "/api/assistant/tasks/wi_1/effects");
    assert.deepEqual(request.body, { effects: [{ kind: "label", mailbox_id: "mbx_1", add: ["finance"] }], note: "filing" });
    assert.equal(request.idempotency, "assistant:effects:wi_1");
    assert.throws(() => buildAssistantRequest("effects", "wi_1", { effects: "not json" }), /must be valid JSON/);
    assert.throws(() => buildAssistantRequest("effects", "wi_1", { effects: "[]" }), /non-empty JSON array/);
  });

  it("escalates with a question and reports with an outcome", () => {
    assert.deepEqual(buildAssistantRequest("escalate", "wi_1", { question: "Pay now?", options: '[{"key":"yes","label":"Yes","outcome":"pay"}]', evidence: "message:m1, plan:p1" }), {
      method: "POST", path: "/api/assistant/tasks/wi_1/escalate", body: { question: "Pay now?", options: [{ key: "yes", label: "Yes", outcome: "pay" }], evidence_refs: ["message:m1", "plan:p1"] },
    });
    assert.throws(() => buildAssistantRequest("escalate", "wi_1", {}), /--question is required/);
    assert.deepEqual(buildAssistantRequest("report", "wi_1", { outcome: "done", summary: "Filed", claims: '[{"kind":"label","ref":"plan:p1"}]' }), {
      method: "POST", path: "/api/assistant/tasks/wi_1/report", body: { outcome: "done", summary: "Filed", claims: [{ kind: "label", ref: "plan:p1" }] },
    });
    assert.throws(() => buildAssistantRequest("report", "wi_1", { outcome: "maybe", summary: "x" }), /--outcome must be done, blocked or handed_back/);
  });

  it("approves or rejects a waiting plan through the fenced interaction", () => {
    assert.deepEqual(buildAssistantRequest("approve", "wi_1", { itemVersion: "4", plan: "pl_1" }), { method: "POST", path: "/api/assistant/work-items/wi_1/interactions", body: { type: "approve", work_item_version: 4, plan_id: "pl_1" }, idempotency: "assistant:approve:wi_1" });
    assert.deepEqual(buildAssistantRequest("reject", "wi_1", { itemVersion: "4", plan: "pl_1", text: "Not now" }).body, { type: "reject", work_item_version: 4, plan_id: "pl_1", reason: "Not now" });
    assert.throws(() => buildAssistantRequest("approve", "wi_1", { itemVersion: "4" }), /--plan is required/);
  });
});
