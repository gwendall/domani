import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField, assertArray, skipIfNoAuth, skipIfNoMutate, testId, TEST_DOMAIN } from "./helpers.js";

describe("domain management workflow", () => {
  describe("list", () => {
    it("lists owned domains", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["list"]);
      assertSuccess(result);
      assertField(result.data, "domains");
      const domains = assertArray(result.data, "domains");
      assert.ok(domains.length > 0, "Expected at least one domain");
    });
  });

  describe("status", () => {
    it("checks domain health", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["status", TEST_DOMAIN], { timeout: 45_000 });
      assertSuccess(result);
      assertField(result.data, "domain");
    });
  });

  describe("settings (read)", () => {
    it("shows domain settings", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["settings", TEST_DOMAIN]);
      assertSuccess(result);
      assertField(result.data, "domain");
      assertField(result.data, "status");
      assertField(result.data, "auto_renew");
    });
  });

  describe("settings (toggle)", () => {
    it("toggles auto-renew and restores", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      // Read current
      const readResult = run(["settings", TEST_DOMAIN]);
      assertSuccess(readResult);
      const original = readResult.data as Record<string, unknown>;
      const wasAutoRenew = original.auto_renew as boolean;

      // Toggle
      const newVal = wasAutoRenew ? "off" : "on";
      const toggleResult = run(["settings", TEST_DOMAIN, "--auto-renew", newVal]);
      assertSuccess(toggleResult);

      // Verify
      const verifyResult = run(["settings", TEST_DOMAIN]);
      assertSuccess(verifyResult);
      assert.equal((verifyResult.data as Record<string, unknown>).auto_renew, !wasAutoRenew);

      // Restore
      const restoreVal = wasAutoRenew ? "on" : "off";
      run(["settings", TEST_DOMAIN, "--auto-renew", restoreVal]);
    });
  });

  describe("dns (read)", () => {
    it("lists DNS records", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["dns", TEST_DOMAIN]);
      assertSuccess(result);
      assertField(result.data, "records");
      assertArray(result.data, "records");
    });

    it("--fields filters array elements", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["dns", TEST_DOMAIN, "--fields", "type,value"]);
      assertSuccess(result);
      const data = result.data as Record<string, unknown>;
      // --fields should drill into the records array
      assertField(data, "records");
      const records = assertArray(data, "records") as Array<Record<string, unknown>>;
      if (records.length > 0) {
        const first = records[0];
        assert.ok("type" in first, "Expected 'type' in filtered record");
        assert.ok("value" in first, "Expected 'value' in filtered record");
        assert.ok(!("name" in first), "Expected 'name' to be filtered out");
      }
    });
  });

  describe("dns CRUD", () => {
    it("creates, verifies, and deletes a TXT record", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;

      const recordName = `_e2e-${Date.now()}`;
      const recordValue = `test-${testId()}`;

      // Set
      const setResult = run(["dns", TEST_DOMAIN, "set", "TXT", recordName, recordValue]);
      assertSuccess(setResult);

      // Verify
      const getResult = run(["dns", TEST_DOMAIN]);
      assertSuccess(getResult);
      const records = assertArray(getResult.data, "records") as Array<{ type: string; name: string; value: string }>;
      assert.ok(
        records.some((r) => r.type === "TXT" && r.name === recordName && r.value === recordValue),
        "TXT record should exist"
      );

      // Delete
      const deleteResult = run(["dns", TEST_DOMAIN, "delete", "TXT", recordName]);
      assertSuccess(deleteResult);

      // Verify deleted
      const afterResult = run(["dns", TEST_DOMAIN]);
      assertSuccess(afterResult);
      const after = assertArray(afterResult.data, "records") as Array<{ type: string; name: string }>;
      assert.ok(!after.some((r) => r.type === "TXT" && r.name === recordName), "Record should be deleted");
    });
  });

  describe("dns snapshot", () => {
    it("captures a DNS snapshot", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["dns", TEST_DOMAIN, "snapshot"], { timeout: 60_000, expectError: true });
      // Skip if endpoint not deployed yet (404)
      if (result.exitCode !== 0) {
        const data = result.data as Record<string, unknown>;
        if (String(data.code) === "not_found") {
          t.skip("snapshot endpoint not deployed yet");
          return;
        }
      }
      assertSuccess(result);
      assertField(result.data, "domain");
      assertField(result.data, "records");
      assertField(result.data, "subdomains");
      assertField(result.data, "sources");
      assertField(result.data, "captured_at");
      const records = assertArray(result.data, "records");
      assert.ok(records.length > 0, "Expected at least 1 DNS record in snapshot");
    });

    it("restores DNS from server backup", (t) => {
      if (skipIfNoAuth(t)) return;
      if (skipIfNoMutate(t)) return;
      // First snapshot to create server backup
      const snapResult = run(["dns", TEST_DOMAIN, "snapshot"], { timeout: 60_000, expectError: true });
      if (snapResult.exitCode !== 0) {
        t.skip("snapshot endpoint not deployed yet");
        return;
      }

      // Then restore from server backup
      const restoreResult = run(["dns", TEST_DOMAIN, "restore"], { timeout: 30_000 });
      assertSuccess(restoreResult);
      assertField(restoreResult.data, "domain");
      assertField(restoreResult.data, "applied");
      assertField(restoreResult.data, "skipped");
    });
  });

  describe("nameservers", () => {
    it("returns nameservers", (t) => {
      if (skipIfNoAuth(t)) return;
      const result = run(["nameservers", TEST_DOMAIN]);
      assertSuccess(result);
      assertField(result.data, "nameservers");
      const ns = assertArray(result.data, "nameservers");
      assert.ok(ns.length >= 2, "Expected at least 2 nameservers");
    });
  });
});
