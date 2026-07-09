import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseRecipients, recipientField } from "../commands/email.js";

describe("parseRecipients", () => {
  it("returns [] for undefined/empty", () => {
    assert.deepEqual(parseRecipients(undefined), []);
    assert.deepEqual(parseRecipients(""), []);
    assert.deepEqual(parseRecipients("  , ,"), []);
  });

  it("returns a single-element list for one address", () => {
    assert.deepEqual(parseRecipients("a@x.com"), ["a@x.com"]);
  });

  it("splits comma-separated addresses and trims whitespace", () => {
    assert.deepEqual(parseRecipients("a@x.com, b@y.com ,c@z.com"), [
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });
});

describe("recipientField (wire form)", () => {
  it("omits an empty list", () => {
    assert.equal(recipientField([]), undefined);
  });

  it("sends a bare string for one recipient (API accepts string OR array)", () => {
    assert.equal(recipientField(["a@x.com"]), "a@x.com");
  });

  it("sends an array for many recipients - the raw comma string would fail .email()", () => {
    assert.deepEqual(recipientField(["a@x.com", "b@y.com"]), ["a@x.com", "b@y.com"]);
  });
});
