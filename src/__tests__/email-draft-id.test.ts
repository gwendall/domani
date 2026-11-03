import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDraftIdArg } from "../commands/email.js";

describe("resolveDraftIdArg (email draft positional id)", () => {
  it("takes the bare draft id positional", () => {
    assert.equal(resolveDraftIdArg("draft_123"), "draft_123");
  });

  it("ignores a user@domain positional - that belongs to --from", () => {
    assert.equal(resolveDraftIdArg("hi@myapp.dev"), undefined);
  });

  it("returns undefined with no positional", () => {
    assert.equal(resolveDraftIdArg(undefined), undefined);
  });
});
