import { describe, it } from "node:test";
import { run, assertSuccess, assertDryRun, assertField, skipIfNoAuth, TEST_DOMAIN } from "./helpers.js";

describe("hosting connection workflow", () => {
  it("lists available providers", (t) => {
    if (skipIfNoAuth(t)) return;
    const result = run(["connect", TEST_DOMAIN, "--list"]);
    assertSuccess(result);
    assertField(result.data, "providers");
  });

  it("dry-run connect to vercel", (t) => {
    if (skipIfNoAuth(t)) return;
    const data = assertDryRun(
      run(["connect", TEST_DOMAIN, "vercel", "--dry-run"]),
      "connect"
    );
    assertField(data, "domain");
  });
});
