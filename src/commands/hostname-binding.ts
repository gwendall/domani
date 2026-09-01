import pc from "picocolors";
import { apiRequest } from "../api.js";
import { persistentIdempotencyKey } from "../idempotency.js";
import { blank, fail, heading, jsonOut } from "../ui.js";

type Options = { json?: boolean; fields?: string; hostname?: string; browserMode?: "stateless" | "dedicated_site" | "trusted_same_site"; expectedZoneVersion?: string; acknowledgements?: string };

async function read(res: Response, options: Options) {
  const data = await res.json();
  if (!res.ok) fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  return data;
}

export async function hostnameBinding(domain: string, action: string | undefined, id: string | undefined, options: Options): Promise<void> {
  const root = `/api/domains/${encodeURIComponent(domain)}/hostname-bindings`;
  let res: Response;
  if (!action || action === "list") res = await apiRequest(root);
  else if (action === "plan") {
    if (!options.hostname) fail("--hostname is required", { code: "validation_error", json: options.json });
    res = await apiRequest(`${root}/plan`, { method: "POST", body: JSON.stringify({ hostname: options.hostname, browser_mode: options.browserMode }) });
  } else if (action === "create") {
    if (!options.hostname) fail("--hostname is required", { code: "validation_error", json: options.json });
    const body = { hostname: options.hostname, browser_mode: options.browserMode, expected_zone_version: options.expectedZoneVersion, acknowledgements: options.acknowledgements?.split(",").map((item) => item.trim()) };
    const receipt = persistentIdempotencyKey(`binding:create:${domain}:${options.hostname}`, body);
    res = await apiRequest(root, { method: "POST", headers: { "Idempotency-Key": receipt.key }, body: JSON.stringify(body) });
    if (res.ok) receipt.complete();
  } else {
    if (!id) fail("Binding ID is required", { hint: `Usage: domani binding ${domain} ${action} <id>`, code: "validation_error", json: options.json });
    const target = `${root}/${encodeURIComponent(id)}`;
    if (action === "get") res = await apiRequest(target);
    else if (action === "verify") res = await apiRequest(`${target}/verify`, { method: "POST" });
    else if (action === "delete") res = await apiRequest(target, { method: "DELETE" });
    else if (action === "update") {
      if (!options.browserMode) fail("--browser-mode is required", { code: "validation_error", json: options.json });
      const body = { browser_mode: options.browserMode, acknowledgements: options.acknowledgements?.split(",").map((item) => item.trim()) };
      const receipt = persistentIdempotencyKey(`binding:update:${domain}:${id}`, body);
      res = await apiRequest(target, { method: "PATCH", headers: { "Idempotency-Key": receipt.key }, body: JSON.stringify(body) });
      if (res.ok) receipt.complete();
    }
    else return fail(`Unknown action: ${action}`, { hint: "Actions: list, plan, create, get, update, verify, delete", code: "validation_error", json: options.json });
  }
  if (res.status === 204) {
    if (options.json) return jsonOut({ disabled: true, id }, options.fields);
    console.log("Hostname binding disabled"); return;
  }
  const data = await read(res, options);
  if (options.json) return jsonOut(data, options.fields);
  blank(); heading(action === "plan" ? "Hostname Binding Plan" : "Hostname Bindings");
  const bindings = data.hostname_bindings || (data.hostname_binding ? [data.hostname_binding] : []);
  if (bindings.length) for (const binding of bindings) console.log(`  ${pc.dim(binding.id)}  ${binding.hostname_pattern}  ${binding.status}  ${binding.browser_mode}`);
  else console.log(JSON.stringify(data, null, 2));
  blank();
}
