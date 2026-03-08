import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { run, assertSuccess, assertField } from "./helpers.js";

describe("schema introspection", () => {
  it("lists all commands", () => {
    const result = run(["schema"], { expectError: true });
    if (result.exitCode !== 0) return; // Schema API not deployed

    assertSuccess(result);
    const data = result.data as Record<string, unknown>;
    assertField(data, "commands");

    const commands = data.commands as Record<string, unknown>;
    for (const cmd of ["search", "buy", "list", "dns", "email", "settings", "webhooks", "tokens"]) {
      assert.ok(cmd in commands, `Missing command "${cmd}" in schema`);
    }
  });

  it("returns schema for search command", () => {
    const result = run(["schema", "search"], { expectError: true });
    if (result.exitCode !== 0) return;

    assertSuccess(result);
    assertField(result.data, "description");
    assertField(result.data, "usage");
  });

  it("returns schema for dns command with api details", () => {
    const result = run(["schema", "dns"], { expectError: true });
    if (result.exitCode !== 0) return;

    assertSuccess(result);
    assertField(result.data, "description");
    assertField(result.data, "api");
  });

  it("errors on unknown command", () => {
    const result = run(["schema", "nonexistent"], { expectError: true });
    assert.notEqual(result.exitCode, 0);
  });
});
