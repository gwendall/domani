import assert from "node:assert/strict";
import test from "node:test";
import { buildLoginRequest } from "../commands/login.js";

test("builds the legacy full-account login request by default", () => {
  assert.deepEqual(buildLoginRequest({}), {
    body: { surface: "cli", intent: "programmatic_access" },
    delegated: false,
  });
});

test("builds a scoped, labeled, expiring delegation request", () => {
  assert.deepEqual(
    buildLoginRequest({
      scopes: " domains:read, search ",
      label: "Project agent",
      expiresIn: "86400",
    }),
    {
      body: {
        scopes: ["domains:read", "search"],
        label: "Project agent",
        expires_in: 86400,
        surface: "cli",
        intent: "programmatic_access",
      },
      delegated: true,
    }
  );
});

test("rejects delegation lifetimes outside the server contract", () => {
  assert.throws(() => buildLoginRequest({ expiresIn: "3599" }), /3600 and 31536000/);
  assert.throws(() => buildLoginRequest({ expiresIn: "not-a-number" }), /3600 and 31536000/);
});

test("attributes supported agent surfaces and rejects unknown ones", () => {
  assert.deepEqual(buildLoginRequest({ surface: "mcp" }).body, {
    surface: "mcp",
    intent: "programmatic_access",
  });
  assert.throws(() => buildLoginRequest({ surface: "browser" }), /cli, mcp, plugin, skill, api/);
});
