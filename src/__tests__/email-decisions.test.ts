import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { authenticationLine, decisionRow, decisionsPath } from "../commands/email-decisions.js";

const strip = (value: string) => value.replace(/\u001b\[[0-9;]*m/g, "");

describe("domani email decisions", () => {
  it("reads the message's decisions route, encoded", () => {
    assert.equal(decisionsPath("hi@myapp.dev", "a/b"), "/api/emails/hi%40myapp.dev/messages/a%2Fb/decisions");
  });

  it("prints one row per decision: when, axis, who, what it did, the change and why", () => {
    const row = decisionRow({ at: "2026-11-06T18:16:47.000Z", axis: "placement", actor: "classifier", action: "rescued", value: "inbox", previous: "spam", applied: true, version: "spam-verdict.v2", commit: "0d814f743abc", reasons: [{ code: "verdict_over_upstream_scan", text: "..." }] });
    assert.deepEqual(row.map(strip), ["11-06 18:16:47", "placement", "classifier", "rescued", "spam -> inbox", "verdict_over_upstream_scan"]);
    const kind = decisionRow({ at: "2026-11-06T18:16:47.000Z", axis: "kind", actor: "rules", action: "set", value: "code", previous: null, applied: true, version: "mail-kind.v2", commit: null, reasons: [{ code: "code_announced", text: "..." }] });
    assert.equal(strip(kind[4]), "code");
  });

  it("summarises the authentication verdict and who wrote it", () => {
    assert.equal(strip(authenticationLine({ spf: "pass", dkim: "pass", dmarc: "pass", authserv_id: "resend.com", trusted: true })), "spf pass, dkim pass, dmarc pass (resend.com, trusted)");
    assert.equal(strip(authenticationLine(null)), "no verdict");
  });
});
