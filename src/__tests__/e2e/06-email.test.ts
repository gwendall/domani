import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, assertArray, skipIfNoAuth, skipIfNoMutate, TEST_DOMAIN } from "./helpers.js";

describe("email workflow", () => {
  describe("email list (read-only)", () => {
    it("lists mailboxes", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["email", "list", "--domain", TEST_DOMAIN]);
      assertSuccess(result);
      assertField(result.data, "mailboxes");
    });
  });

  describe("email status (read-only)", () => {
    it("checks email setup status", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["email", "status", "--domain", TEST_DOMAIN]);
      assertSuccess(result);
      assertField(result.data, "enabled");
    });
  });

  describe("email CRUD lifecycle", () => {
    it("setup → create → list → delete", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      const slug = `e2e-${Date.now()}`;

      // Setup (idempotent)
      const setupResult = run(["email", "setup", "--domain", TEST_DOMAIN]);
      assertSuccess(setupResult);

      // Create mailbox
      const createResult = run(["email", "create", "--domain", TEST_DOMAIN, "--slug", slug]);
      assertSuccess(createResult);
      assertField(createResult.data, "address");
      assert.ok(
        ((createResult.data as Record<string, unknown>).address as string).startsWith(slug + "@"),
        "Address should start with slug"
      );

      // Verify in list
      const listResult = run(["email", "list", "--domain", TEST_DOMAIN]);
      assertSuccess(listResult);
      const mailboxes = assertArray(listResult.data, "mailboxes") as Array<{ address: string }>;
      assert.ok(mailboxes.some((m) => m.address.startsWith(slug + "@")), "Mailbox should appear in list");

      // Delete (cleanup)
      const deleteResult = run(["email", "delete", "--domain", TEST_DOMAIN, "--slug", slug]);
      assertSuccess(deleteResult);
    });
  });
});
