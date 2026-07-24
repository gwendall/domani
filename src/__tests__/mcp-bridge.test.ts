import assert from "node:assert/strict";
import test from "node:test";
import { parseSseJson, proxyMcpPayload } from "../mcp-bridge.js";

test("forwards JSON-RPC through Streamable HTTP using an in-memory keychain token", async () => {
  let receivedAuthorization = "";
  const payload = { jsonrpc: "2.0", id: 7, method: "tools/list", params: {} };

  const responses = await proxyMcpPayload(payload, {
    apiUrl: "https://domani.run/",
    getAuthToken: () => "test-secret-that-must-not-be-returned",
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://domani.run/mcp");
      receivedAuthorization = new Headers(init?.headers).get("authorization") ?? "";
      assert.deepEqual(JSON.parse(String(init?.body)), payload);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 7, result: { tools: [] } }), {
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(receivedAuthorization, "Bearer test-secret-that-must-not-be-returned");
  assert.deepEqual(responses, [{ jsonrpc: "2.0", id: 7, result: { tools: [] } }]);
  assert.doesNotMatch(JSON.stringify(responses), /test-secret/);
});

test("returns an actionable auth error with the original request id and no token", async () => {
  const responses = await proxyMcpPayload(
    { jsonrpc: "2.0", id: "send-1", method: "tools/call", params: {} },
    {
      apiUrl: "https://domani.run",
      getAuthToken: () => undefined,
      fetchImpl: async (_url, init) => {
        assert.equal(new Headers(init?.headers).has("authorization"), false);
        return new Response("Unauthorized", { status: 401 });
      },
    }
  );

  assert.equal((responses[0] as any).id, "send-1");
  assert.equal((responses[0] as any).error.data.code, "AUTH_REQUIRED");
  assert.match((responses[0] as any).error.data.hint, /Never paste an API key/);
});

test("refreshes a rotated keychain token after one unauthorized response", async () => {
  const authorizations: Array<string | null> = [];
  const responses = await proxyMcpPayload(
    { jsonrpc: "2.0", id: 8, method: "tools/list", params: {} },
    {
      apiUrl: "https://domani.run",
      getAuthToken: () => "expired-secret",
      refreshAuthToken: () => "fresh-secret",
      fetchImpl: async (_url, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization"));
        if (authorizations.length === 1) return new Response("Unauthorized", { status: 401 });
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 8, result: { tools: [] } }), {
          headers: { "content-type": "application/json" },
        });
      },
    }
  );

  assert.deepEqual(authorizations, ["Bearer expired-secret", "Bearer fresh-secret"]);
  assert.deepEqual(responses, [{ jsonrpc: "2.0", id: 8, result: { tools: [] } }]);
  assert.doesNotMatch(JSON.stringify(responses), /secret/);
});

test("does not answer failed JSON-RPC notifications", async () => {
  const responses = await proxyMcpPayload(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      apiUrl: "https://domani.run",
      getAuthToken: () => undefined,
      fetchImpl: async () => new Response("Unauthorized", { status: 401 }),
    }
  );
  assert.deepEqual(responses, []);
});

test("parses JSON-RPC messages from an SSE response", () => {
  assert.deepEqual(
    parseSseJson('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\ndata: [DONE]\n'),
    [{ jsonrpc: "2.0", id: 1, result: {} }]
  );
});

test("maps network failures to a stable MCP error", async () => {
  const responses = await proxyMcpPayload(
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    {
      apiUrl: "https://domani.run",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    }
  );
  assert.equal((responses[0] as any).id, 3);
  assert.equal((responses[0] as any).error.data.code, "MCP_NETWORK_ERROR");
});
