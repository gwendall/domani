import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSendBody, systemLocale } from "../commands/email.js";

const base = { to: "bob@example.com", text: "Thanks" };

describe("systemLocale", () => {
  it("matches Intl's own resolved locale and time zone", () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    assert.deepEqual(systemLocale(), { locale: resolved.locale, timeZone: resolved.timeZone });
  });
});

describe("buildSendBody - quote_original", () => {
  it("is absent without --in-reply-to", () => {
    const body = buildSendBody({ ...base });
    assert.equal(body.in_reply_to, undefined);
    assert.equal(body.quote_original, undefined);
  });

  it("defaults on with --in-reply-to, in the system locale and time zone", () => {
    const body = buildSendBody({ ...base, inReplyTo: "<orig@example.com>" });
    assert.equal(body.in_reply_to, "<orig@example.com>");
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    assert.deepEqual(body.quote_original, { locale: resolved.locale, time_zone: resolved.timeZone });
  });

  it("explicitly disables the server's default with --no-quote", () => {
    const body = buildSendBody({ ...base, inReplyTo: "<orig@example.com>", quote: false });
    assert.equal(body.in_reply_to, "<orig@example.com>");
    assert.equal(body.quote_original, false);
  });

  it("stays on alongside --send-at (a scheduled reply)", () => {
    const body = buildSendBody({ ...base, inReplyTo: "<orig@example.com>", sendAt: "2026-12-01T09:00:00Z" });
    assert.equal(body.send_at, "2026-12-01T09:00:00Z");
    assert.ok(body.quote_original);
  });

  it("stays on alongside cc and bcc", () => {
    const body = buildSendBody({ ...base, inReplyTo: "<orig@example.com>", cc: "carol@example.com", bcc: "dave@example.com" });
    assert.equal(body.cc, "carol@example.com");
    assert.equal(body.bcc, "dave@example.com");
    assert.ok(body.quote_original);
  });

  it("forwards an explicit --references chain unchanged", () => {
    const body = buildSendBody({ ...base, inReplyTo: "<orig@example.com>", references: "<first@example.com> <orig@example.com>" });
    assert.equal(body.references, "<first@example.com> <orig@example.com>");
  });

  it("never sends quote_original without in_reply_to, even if --quote is left at its default", () => {
    const body = buildSendBody({ ...base });
    assert.equal("quote_original" in body, false);
  });
});
