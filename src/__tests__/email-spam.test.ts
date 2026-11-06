import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gestureMessageId, gesturePath, removeRulePath, ruleDescription, senderRuleBody, senderRulesQuery, suggestionCommand } from "../commands/email-spam.js";

describe("domani email spam / not-spam", () => {
  it("takes the message from the argument or --message-id, never from a mailbox address", () => {
    assert.equal(gestureMessageId("msg_1", {}), "msg_1");
    assert.equal(gestureMessageId(undefined, { messageId: "msg_2" }), "msg_2");
    assert.equal(gestureMessageId("hi@myapp.dev", {}), undefined);
  });

  it("posts to the message's spam and not-spam routes, encoded", () => {
    assert.equal(gesturePath("hi@myapp.dev", "a/b", "spam"), "/api/emails/hi%40myapp.dev/messages/a%2Fb/spam");
    assert.equal(gesturePath("hi@myapp.dev", "m1", "not-spam"), "/api/emails/hi%40myapp.dev/messages/m1/not-spam");
  });

  it("prints the exact command that applies each suggestion", () => {
    assert.equal(suggestionCommand({ match: "domain", value: "secure.net" }, "hi@myapp.dev", "m1"), "domani email sender-rule-add --action block --match domain --value secure.net");
    assert.equal(suggestionCommand({ match: "campaign", value: "0123456789abcdef01234567" }, "hi@myapp.dev", "m1"), "domani email sender-rule-add --action block --match campaign --from hi@myapp.dev --message-id m1");
  });
});

describe("domani email sender rules", () => {
  it("filters and pages the list", () => {
    assert.equal(senderRulesQuery({}), "");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(senderRulesQuery({ action: "block", limit: "20", cursor: "c1" }).slice(1))), { action: "block", limit: "20", cursor: "c1" });
  });

  it("builds a rule from a value, or from a message for a campaign", () => {
    assert.deepEqual(senderRuleBody({ action: "block", match: "domain", value: "secure.net" }), { body: { action: "block", match: "domain", value: "secure.net" } });
    assert.deepEqual(senderRuleBody({ action: "block", match: "campaign", slug: "hi", domain: "myapp.dev", messageId: "m1", confirm: true }), { body: { action: "block", match: "campaign", mailbox: "hi@myapp.dev", message_id: "m1", confirm: true } });
  });

  it("refuses what the API would refuse, before calling it", () => {
    assert.deepEqual(senderRuleBody({ action: "drop", match: "domain", value: "x.com" }), { error: "--action must be block or allow" });
    assert.deepEqual(senderRuleBody({ action: "block", match: "campaign", value: "abc" }), { error: "A campaign rule is taken from a message: pass --from and --message-id" });
    assert.deepEqual(senderRuleBody({ action: "block", match: "address", messageId: "m1" }), { error: "--message-id needs --from, the mailbox the message is in" });
    assert.deepEqual(senderRuleBody({ action: "allow", match: "address" }), { error: "Pass --value, or --from and --message-id" });
  });

  it("removes a rule and puts its mail back unless --keep-moved", () => {
    assert.equal(removeRulePath("rule_1"), "/api/sender-rules/rule_1");
    assert.equal(removeRulePath("rule_1", true), "/api/sender-rules/rule_1?restore=false");
  });

  it("names a rule the way the owner recognises it", () => {
    assert.equal(ruleDescription({ match: "domain", value: "secure.net", label: null }), "everything from secure.net");
    assert.equal(ruleDescription({ match: "campaign", value: "0123456789abcdef01234567", label: "Your account is limited" }), 'campaign "Your account is limited"');
    assert.equal(ruleDescription({ match: "address", value: "alerts@secure.net", label: null }), "alerts@secure.net");
  });
});
