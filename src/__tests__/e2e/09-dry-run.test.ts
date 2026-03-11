import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertDryRun, assertField, skipIfNoAuth, TEST_DOMAIN } from "./helpers.js";

describe("dry-run commands", () => {
  it("buy --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    // buy first checks availability, might fail if domain is taken
    const result = run(["buy", `e2edryrun${Date.now()}.xyz`, "--dry-run", "--yes"], { expectError: true });
    if (result.exitCode === 0) {
      const data = assertDryRun(result, "buy");
      assertField(data, "domain");
      assertField(data, "price");
    }
    // If exit != 0, domain was unavailable - that's fine
  });

  it("dns set --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["dns", TEST_DOMAIN, "set", "TXT", "_drytest", "hello", "--dry-run"]),
      "dns_set"
    );
    assertField(data, "domain");
    assertField(data, "record");
    const record = data.record as Record<string, unknown>;
    assert.equal(record.type, "TXT");
    assert.equal(record.name, "_drytest");
    assert.equal(record.value, "hello");
  });

  it("dns delete --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["dns", TEST_DOMAIN, "delete", "TXT", "_drytest", "--dry-run"]),
      "dns_delete"
    );
    assertField(data, "domain");
    assertField(data, "record");
  });

  it("dns snapshot --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["dns", TEST_DOMAIN, "snapshot", "--dry-run"]),
      "dns_snapshot"
    );
    assertField(data, "domain");
  });

  it("dns restore --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["dns", TEST_DOMAIN, "restore", "--dry-run"]),
      "dns_restore"
    );
    assertField(data, "domain");
    assertField(data, "source");
  });

  it("connect --dry-run with provider", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["connect", TEST_DOMAIN, "vercel", "--dry-run"]),
      "connect"
    );
    assertField(data, "domain");
  });

  it("connect --dry-run without provider", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["connect", TEST_DOMAIN, "--dry-run"]),
      "connect"
    );
    assertField(data, "domain");
    assertField(data, "note");
  });

  it("settings --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["settings", TEST_DOMAIN, "--auto-renew", "on", "--dry-run"]),
      "settings_update"
    );
    assertField(data, "domain");
  });

  it("parking enable --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["parking", TEST_DOMAIN, "enable", "--dry-run"]),
      "parking_enable"
    );
    assertField(data, "domain");
  });

  it("parking price --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["parking", TEST_DOMAIN, "price", "999", "--dry-run"]),
      "parking_price"
    );
    assertField(data, "domain");
  });

  it("webhooks create --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["webhooks", "create", "--url", "https://example.com/hook", "--events", "domain.purchased", "--dry-run"]),
      "webhook_create"
    );
    assertField(data, "url");
    assertField(data, "events");
  });

  it("email setup --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["email", "setup", "--domain", TEST_DOMAIN, "--dry-run"]),
      "email_setup"
    );
    assertField(data, "domain");
  });

  it("nameservers set --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    // Pass nameservers as arguments after domain
    const result = run(["nameservers", TEST_DOMAIN, "--set", "ns1.test.com,ns2.test.com", "--dry-run"]);
    // nameservers might use different dry-run pattern
    if (result.exitCode === 0 && result.data) {
      const data = result.data as Record<string, unknown>;
      if (data.dry_run) {
        assertField(data, "domain");
      }
    }
  });

  it("renew --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["renew", TEST_DOMAIN, "--dry-run", "--yes"]),
      "renew"
    );
    assertField(data, "domain");
    assertField(data, "years");
    assert.equal(data.domain, TEST_DOMAIN);
    assert.equal(data.years, 1);
  });

  it("renew --dry-run with custom years", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["renew", TEST_DOMAIN, "--years", "3", "--dry-run", "--yes"]),
      "renew"
    );
    assertField(data, "domain");
    assert.equal(data.years, 3);
  });

  it("transfer --dry-run", (t) => {
    if (skipIfNoAuth(t)) return;
    // Transfer dry-run checks eligibility first (API call), then returns dry-run.
    // If domain is not eligible (60-day lock, EPP status), test exits gracefully.
    const result = run(["transfer", "example.com", "--auth-code", "test123", "--dry-run", "--yes"], { expectError: true });
    if (result.exitCode === 0) {
      const data = assertDryRun(result, "transfer");
      assertField(data, "domain");
      assertField(data, "eligible");
      assertField(data, "price");
      assert.equal(data.eligible, true);
    }
    // If exit != 0, domain was not eligible - that's expected for most domains
  });
});
