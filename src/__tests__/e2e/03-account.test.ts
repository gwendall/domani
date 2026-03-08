import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, assertArray, skipIfNoAuth, skipIfNoMutate, testId } from "./helpers.js";

describe("account workflow", () => {
  describe("me", () => {
    it("returns account info", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["me"]);
      assertSuccess(result);
      assertField(result.data, "email");
      assertField(result.data, "domain_count");
    });

    it("supports --fields filter", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["me", "--fields", "email,domain_count"]);
      assertSuccess(result);
      const data = result.data as Record<string, unknown>;
      assert.ok("email" in data);
      assert.ok("domain_count" in data);
    });
  });

  describe("contact", () => {
    it("returns contact info", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["contact"]);
      assertSuccess(result);
      assertField(result.data, "has_contact");
    });
  });

  describe("invoices", () => {
    it("lists invoices", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["invoices"]);
      assertSuccess(result);
      assertField(result.data, "invoices");
      assertArray(result.data, "invoices");
    });

    it("limits invoice count", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["invoices", "--limit", "1"]);
      assertSuccess(result);
      const invoices = assertArray(result.data, "invoices");
      assert.ok(invoices.length <= 1);
    });
  });

  describe("tokens CRUD", () => {
    it("lists tokens", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["tokens", "list"]);
      assertSuccess(result);
      assertField(result.data, "tokens");
      assertArray(result.data, "tokens");
    });

    it("creates and revokes a token", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      const name = `test-${testId()}`;

      // Create
      const createResult = run(["tokens", "create", "--name", name, "--scopes", "domains:read"]);
      assertSuccess(createResult);
      const created = createResult.data as Record<string, unknown>;
      assertField(created, "id");
      assertField(created, "key");
      assert.equal(created.name, name);
      const tokenId = created.id as string;

      // Verify in list
      const listResult = run(["tokens", "list"]);
      assertSuccess(listResult);
      const tokens = assertArray(listResult.data, "tokens") as Array<{ id: string }>;
      assert.ok(tokens.some((t) => t.id === tokenId), "Token should appear in list");

      // Revoke
      const revokeResult = run(["tokens", "revoke", "--token-id", tokenId]);
      assertSuccess(revokeResult);

      // Verify removed
      const afterResult = run(["tokens", "list"]);
      assertSuccess(afterResult);
      const after = assertArray(afterResult.data, "tokens") as Array<{ id: string }>;
      assert.ok(!after.some((t) => t.id === tokenId), "Token should be removed");
    });
  });
});
