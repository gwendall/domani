import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MailboxUsageError, buildMailboxRequest } from "../commands/mailbox.js";

describe("domani mailbox request planning", () => {
  it("connects gmail with a preset or a date, reads the connection, widens the import, disconnects", () => {
    assert.deepEqual(buildMailboxRequest("connect", "gmail", {}), { method: "POST", path: "/api/emails/connect/gmail", body: {} });
    assert.deepEqual(buildMailboxRequest("connect", undefined, { window: "30d", workspace: "ws_1" }), { method: "POST", path: "/api/emails/connect/gmail", body: { window: "30d", workspace_id: "ws_1" } });
    assert.deepEqual(buildMailboxRequest("connect", "gmail", { since: "2026-06-01" }), { method: "POST", path: "/api/emails/connect/gmail", body: { since: "2026-06-01" } });
    assert.deepEqual(buildMailboxRequest("connector", "Someone@Gmail.com", {}), { method: "GET", path: "/api/emails/someone%40gmail.com/connector" });
    assert.deepEqual(buildMailboxRequest("import", "someone@gmail.com", { since: "2026-01-01" }), { method: "POST", path: "/api/emails/someone%40gmail.com/import", body: { since: "2026-01-01" } });
    assert.deepEqual(buildMailboxRequest("disconnect", "someone@gmail.com", {}), { method: "DELETE", path: "/api/emails/someone%40gmail.com/connector" });
  });

  it("connects an inbox by forwarding and sends the probe", () => {
    assert.deepEqual(buildMailboxRequest("connect", "forwarding", { address: "Me@Outlook.com" }), { method: "POST", path: "/api/emails/connect/forwarding", body: { address: "Me@Outlook.com" } });
    assert.deepEqual(buildMailboxRequest("connect", "forwarding", { address: "me@outlook.com", workspace: "ws_1" }), { method: "POST", path: "/api/emails/connect/forwarding", body: { address: "me@outlook.com", workspace_id: "ws_1" } });
    assert.throws(() => buildMailboxRequest("connect", "forwarding", {}), (error: unknown) => error instanceof MailboxUsageError);
    assert.deepEqual(buildMailboxRequest("verify", "Me@Outlook.com", {}), { method: "POST", path: "/api/emails/me%40outlook.com/connector/verify" });
    assert.throws(() => buildMailboxRequest("verify", undefined, {}), (error: unknown) => error instanceof MailboxUsageError);
  });

  it("refuses an unknown provider, both bounds at once, and a missing address or date", () => {
    assert.throws(() => buildMailboxRequest("connect", "outlook", {}), (error: unknown) => error instanceof MailboxUsageError);
    assert.throws(() => buildMailboxRequest("connect", "gmail", { since: "2026-06-01", window: "7d" }), (error: unknown) => error instanceof MailboxUsageError);
    assert.throws(() => buildMailboxRequest("connector", undefined, {}), (error: unknown) => error instanceof MailboxUsageError);
    assert.throws(() => buildMailboxRequest("import", "someone@gmail.com", {}), (error: unknown) => error instanceof MailboxUsageError);
    assert.throws(() => buildMailboxRequest("nope", undefined, {}), (error: unknown) => error instanceof MailboxUsageError);
  });
});
