import pc from "picocolors";
import { apiRequest } from "../api.js";
import { persistentIdempotencyKey } from "../idempotency.js";
import { blank, createSpinner, fail, heading, jsonOut, row, S } from "../ui.js";

type Options = {
  json?: boolean; fields?: string; hostname?: string; upstream?: string; domain?: string; status?: string;
  expiresIn?: string; hostHeader?: "public" | "upstream"; upstreamVerification?: "none" | "signed_headers";
  idempotencyKey?: string;
  upstreamAuthorizationEnv?: string; upstreamApiKeyEnv?: string; clearUpstreamHeaders?: boolean;
};

function upstreamHeadersFromEnv(options: Options): Record<string, string> | undefined {
  if (options.clearUpstreamHeaders) return {};
  const headers: Record<string, string> = {};
  for (const [name, envName] of [["Authorization", options.upstreamAuthorizationEnv], ["X-Api-Key", options.upstreamApiKeyEnv]] as const) {
    if (!envName) continue;
    const value = process.env[envName];
    if (!value) fail(`Environment variable ${envName} is empty`, { code: "validation_error", json: options.json });
    headers[name] = value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

async function responseOrFail(res: Response, options: Options) {
  const data = await res.json();
  if (!res.ok) fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  return data;
}

function showRoute(data: any, options: Options): void {
  if (options.json) return jsonOut(data, options.fields);
  const route = data.http_route || data;
  blank(); heading("HTTP Route");
  row("ID", route.id); row("URL", route.url); row("Upstream", route.upstream); row("Status", route.status);
  row("Expires", route.expires_at); row("Browser mode", route.browser_mode || "stateless");
  if (route.upstream_verification?.secret) {
    row("Verification secret", pc.yellow(route.upstream_verification.secret));
    console.log(pc.dim("  Save this secret now. It will not be shown again after this receipt."));
  }
  blank();
}

export async function httpRoute(action: string | undefined, id: string | undefined, options: Options): Promise<void> {
  if (!action || action === "list") {
    const query = new URLSearchParams();
    if (options.domain) query.set("domain", options.domain);
    if (options.hostname) query.set("hostname", options.hostname);
    if (options.status) query.set("status", options.status);
    const data = await responseOrFail(await apiRequest(`/api/http-routes${query.size ? `?${query}` : ""}`), options);
    if (options.json) return jsonOut(data, options.fields);
    blank(); heading("HTTP Routes");
    for (const route of data.http_routes) console.log(`  ${pc.dim(route.id)}  ${route.hostname}  ${route.status}  ${route.upstream}`);
    blank(); return;
  }
  if (action === "create") {
    if (!options.upstream) fail("--upstream is required", { code: "validation_error", json: options.json });
    const upstreamHeaders = upstreamHeadersFromEnv(options);
    const body = {
      ...(options.hostname ? { hostname: options.hostname } : {}), upstream: options.upstream,
      ...(options.expiresIn ? { expires_in: Number(options.expiresIn) } : {}),
      ...(options.hostHeader ? { host_header: options.hostHeader } : {}),
      ...(options.upstreamVerification ? { upstream_verification: options.upstreamVerification } : {}),
      ...(upstreamHeaders ? { upstream_headers: upstreamHeaders } : {}),
    };
    const receipt = persistentIdempotencyKey(`route:create:${options.hostname || "auto"}`, body, options.idempotencyKey);
    const spinner = createSpinner(!options.json); spinner.start("Creating HTTP route");
    const data = await responseOrFail(await apiRequest("/api/http-routes", { method: "POST", headers: { "Idempotency-Key": receipt.key }, body: JSON.stringify(body) }), options);
    receipt.complete(); spinner.stop(`${S.success} HTTP route created`); return showRoute(data, options);
  }
  if (!id) fail("Route ID is required", { hint: `Usage: domani route ${action} <id>`, code: "validation_error", json: options.json });
  if (action === "get") return showRoute(await responseOrFail(await apiRequest(`/api/http-routes/${encodeURIComponent(id)}`), options), options);
  if (action === "delete") {
    const res = await apiRequest(`/api/http-routes/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) await responseOrFail(res, options);
    if (options.json) return jsonOut({ deleted: true, id }, options.fields);
    console.log(`${S.success} HTTP route deleted`); return;
  }
  if (action === "refresh") {
    if (!options.expiresIn) fail("--expires-in is required", { code: "validation_error", json: options.json });
    const body = { expires_in: Number(options.expiresIn) };
    const receipt = persistentIdempotencyKey(`route:refresh:${id}`, body, options.idempotencyKey);
    const data = await responseOrFail(await apiRequest(`/api/http-routes/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Idempotency-Key": receipt.key }, body: JSON.stringify(body) }), options);
    receipt.complete(); return showRoute(data, options);
  }
  if (action === "rotate-verification") {
    const receipt = persistentIdempotencyKey(`route:rotate-verification:${id}`, {}, options.idempotencyKey);
    const data = await responseOrFail(await apiRequest(`/api/http-routes/${encodeURIComponent(id)}/upstream-verification/rotate`, { method: "POST", headers: { "Idempotency-Key": receipt.key } }), options);
    receipt.complete();
    if (options.json) return jsonOut(data, options.fields);
    return showRoute(data, options);
  }
  if (action === "rotate-headers") {
    const headers = upstreamHeadersFromEnv(options);
    if (!headers) fail("Provide an upstream header environment variable or --clear-upstream-headers", { code: "validation_error", json: options.json });
    const receipt = persistentIdempotencyKey(`route:rotate-headers:${id}`, { upstream_headers: headers }, options.idempotencyKey);
    const data = await responseOrFail(await apiRequest(`/api/http-routes/${encodeURIComponent(id)}/upstream-headers`, { method: "PUT", headers: { "Idempotency-Key": receipt.key }, body: JSON.stringify({ upstream_headers: headers }) }), options);
    receipt.complete();
    if (options.json) return jsonOut(data, options.fields);
    console.log(`${S.success} Upstream headers replaced: ${data.upstream_header_names.join(", ") || "none"}`); return;
  }
  fail(`Unknown action: ${action}`, { hint: "Actions: create, list, get, refresh, rotate-verification, rotate-headers, delete", code: "validation_error", json: options.json });
}
