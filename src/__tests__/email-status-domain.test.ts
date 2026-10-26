import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDomainArg } from "../commands/email.js";

describe("resolveDomainArg (email status/setup positional domain)", () => {
  it("takes the bare domain positional, as the help text documents", () => {
    assert.equal(resolveDomainArg("streetsofnice.com", {}), "streetsofnice.com");
  });

  it("prefers --domain over the positional", () => {
    assert.equal(resolveDomainArg("other.com", { domain: "myapp.dev" }), "myapp.dev");
  });

  it("leaves user@domain alone - that is parseEmailArg's job, not this one", () => {
    assert.equal(resolveDomainArg("hi@myapp.dev", {}), undefined);
  });

  it("returns undefined with neither --domain nor a positional", () => {
    assert.equal(resolveDomainArg(undefined, {}), undefined);
  });
});
