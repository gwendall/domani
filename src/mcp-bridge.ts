import readline from "node:readline";
import { getApiUrl, getToken } from "./config.js";

type JsonRpcId = string | number | null;
type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  [key: string]: unknown;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface McpBridgeOptions {
  apiUrl?: string;
  fetchImpl?: FetchLike;
  getAuthToken?: () => string | undefined;
  refreshAuthToken?: () => string | undefined;
  verbose?: boolean;
  stderr?: Pick<NodeJS.WriteStream, "write">;
}

function requestMessages(payload: unknown): JsonRpcMessage[] {
  const values = Array.isArray(payload) ? payload : [payload];
  return values.filter(
    (value): value is JsonRpcMessage => Boolean(value) && typeof value === "object"
  );
}

function errorFor(id: JsonRpcId, code: number, message: string, data?: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  };
}

function errorsForPayload(
  payload: unknown,
  code: number,
  message: string,
  data?: Record<string, unknown>
): unknown | undefined {
  const responses = requestMessages(payload)
    .filter((entry) => Object.prototype.hasOwnProperty.call(entry, "id"))
    .map((entry) => errorFor(entry.id ?? null, code, message, data));
  if (responses.length === 0) return undefined;
  return Array.isArray(payload) ? responses : responses[0];
}

export function parseSseJson(body: string): unknown[] {
  const values: unknown[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      values.push(JSON.parse(data));
    } catch {
      // Ignore non-JSON keepalive/event data. MCP JSON-RPC payloads are JSON.
    }
  }
  return values;
}

/**
 * Forward one stdio MCP JSON-RPC payload to Domani's Streamable HTTP server.
 * The API token is resolved from the CLI keychain for every request and is
 * never written to stdout, stderr, plugin config, or the model context.
 */
export async function proxyMcpPayload(
  payload: unknown,
  options: McpBridgeOptions = {}
): Promise<unknown[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let token = options.getAuthToken
    ? options.getAuthToken()
    : getToken();
  const baseUrl = (options.apiUrl ?? getApiUrl()).replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const request = () => fetchImpl(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  let response: Response;
  try {
    response = await request();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Unknown network error";
    const error = errorsForPayload(payload, -32002, "Domani MCP is unreachable", {
      code: "MCP_NETWORK_ERROR",
      hint: `Check your connection and that ${baseUrl} is reachable.`,
      detail,
    });
    return error === undefined ? [] : [error];
  }

  // A long-running editor may outlive a login or token rotation. Refresh the
  // keychain and retry exactly once without asking the user to restart it.
  if (response.status === 401) {
    const refreshedToken = options.refreshAuthToken
      ? options.refreshAuthToken()
      : options.getAuthToken
        ? undefined
        : getToken({ refreshKeychain: true });
    if (refreshedToken && refreshedToken !== token) {
      await response.body?.cancel();
      token = refreshedToken;
      headers.Authorization = `Bearer ${token}`;
      try {
        response = await request();
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : "Unknown network error";
        const error = errorsForPayload(payload, -32002, "Domani MCP is unreachable", {
          code: "MCP_NETWORK_ERROR",
          hint: `Check your connection and that ${baseUrl} is reachable.`,
          detail,
        });
        return error === undefined ? [] : [error];
      }
    }
  }

  if (response.status === 202 || response.status === 204) return [];

  const body = await response.text();
  if (response.status === 401) {
    const error = errorsForPayload(payload, -32001, "Domani authentication required", {
      code: "AUTH_REQUIRED",
      hint: "Run `npx -y domani-cli@latest login`, approve access in the browser, then retry. Never paste an API key into chat.",
      fix_command: "npx -y domani-cli@latest login",
    });
    return error === undefined ? [] : [error];
  }

  if (!response.ok) {
    const error = errorsForPayload(payload, -32000, `Domani MCP request failed (${response.status})`, {
      code: "MCP_HTTP_ERROR",
      hint: "Retry once. If the error persists, check https://domani.run/status.",
    });
    return error === undefined ? [] : [error];
  }

  if (!body.trim()) return [];
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) return parseSseJson(body);

  try {
    return [JSON.parse(body)];
  } catch {
    const error = errorsForPayload(payload, -32700, "Domani MCP returned invalid JSON", {
      code: "MCP_INVALID_RESPONSE",
    });
    return error === undefined ? [] : [error];
  }
}

export async function serveMcpBridge(options: McpBridgeOptions = {}): Promise<void> {
  const stderr = options.stderr ?? process.stderr;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();

  if (options.verbose) stderr.write("domani MCP bridge ready\n");

  for await (const line of input) {
    if (!line.trim()) continue;
    const task = (async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(line);
      } catch {
        process.stdout.write(`${JSON.stringify(errorFor(null, -32700, "Parse error"))}\n`);
        return;
      }

      const responses = await proxyMcpPayload(payload, options);
      for (const response of responses) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    })().catch((cause) => {
      if (options.verbose) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        stderr.write(`domani MCP bridge internal error: ${detail}\n`);
      }
      process.stdout.write(
        `${JSON.stringify(errorFor(null, -32603, "Domani MCP bridge internal error"))}\n`
      );
    });
    pending.add(task);
    void task.then(() => pending.delete(task));
  }

  await Promise.all(pending);
}
