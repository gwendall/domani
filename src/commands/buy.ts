import { apiRequest } from "../api.js";
import { confirm as clackConfirm, text, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, createProgressTable, jsonOut, skipConfirm, dryRunOut, fail, isTTY } from "../ui.js";
import { requireValidDomain, requireValidDomains } from "../validate.js";

/* ── Single domain buy (original flow) ─────────────────────── */

async function buySingle(
  domain: string,
  options: { yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  requireValidDomain(domain, options);
  const s = createSpinner(!options.json);
  s.start(`Checking ${fmt.domain(domain)}`);

  const searchRes = await apiRequest(`/api/domains/search?q=${encodeURIComponent(domain)}`);
  const searchData = await searchRes.json();

  if (!searchRes.ok) {
    s.stop("Search failed");
    fail(searchData.error, { hint: searchData.hint, status: searchRes.status, json: options.json, fields: options.fields });
  }

  if (!searchData.available) {
    s.stop(`${S.error} ${fmt.domain(domain)} is not available`);
    fail(`${domain} is not available`, { code: "not_available", json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} ${fmt.domain(domain)} ${S.dot} available ${S.dot} ${fmt.price(searchData.price)}/yr`);

  if (options.dryRun) {
    return dryRunOut("buy", {
      domain,
      available: true,
      price: searchData.price,
      currency: searchData.currency || "USD",
    }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    blank();
    const ok = await clackConfirm({
      message: `Purchase ${pc.bold(domain)} for ${fmt.price(searchData.price)}/yr?`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  const p = createSpinner(!options.json);
  p.start("Purchasing");

  const res = await apiRequest("/api/domains/buy", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  const data = await res.json();

  if (!res.ok) {
    p.stop("Purchase failed");
    fail(data.error || data.message, { hint: data.hint, fixUrl: data.setup_url, status: res.status, json: options.json, fields: options.fields });
  }

  p.stop(`${S.success} ${fmt.domain(data.domain)} is yours!`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading(data.domain);
  row("Status", fmt.success("Active"));
  row("Expires", new Date(data.expires).toLocaleDateString());
  if (data.price) row("Price", fmt.price(data.price) + pc.dim(` ${data.currency || "USD"}`));
  blank();
  hintCommand("Configure DNS:", `domani dns ${data.domain}`);
  blank();
}

/* ── Bulk domain buy ───────────────────────────────────────── */

async function buyBulk(
  domains: string[],
  options: { yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  requireValidDomains(domains, options);
  const useJson = !!options.json;

  // 1. Check availability for all domains first
  const s = createSpinner(!useJson);
  s.start(`Checking ${domains.length} domains`);

  const checks = await Promise.all(
    domains.map(async (d) => {
      try {
        const res = await apiRequest(`/api/domains/search?q=${encodeURIComponent(d)}`);
        const data = await res.json();
        return { domain: d, available: res.ok && data.available, price: data.price as number | undefined };
      } catch {
        return { domain: d, available: false, price: undefined };
      }
    })
  );

  const available = checks.filter((c) => c.available);
  const unavailable = checks.filter((c) => !c.available);

  if (available.length === 0) {
    s.stop(`${S.error} None of the ${domains.length} domains are available`);
    process.exit(1);
  }

  const total = available.reduce((sum, c) => sum + (c.price || 0), 0);
  s.stop(`${S.success} ${available.length}/${domains.length} available ${S.dot} ${fmt.price(total.toFixed(2))} total`);

  if (unavailable.length > 0) {
    for (const u of unavailable) {
      console.log(`  ${S.error} ${fmt.domain(u.domain)} ${pc.dim("not available")}`);
    }
  }

  if (options.dryRun) {
    return dryRunOut("buy_bulk", {
      domains: available.map((c) => ({ domain: c.domain, price: c.price })),
      unavailable: unavailable.map((c) => c.domain),
      total_price: parseFloat(total.toFixed(2)),
    }, options.json, options.fields);
  }

  // 2. Confirm
  if (!skipConfirm(options)) {
    blank();
    const ok = await clackConfirm({
      message: `Purchase ${pc.bold(String(available.length))} domain${available.length > 1 ? "s" : ""} for ${fmt.price(total.toFixed(2))}?`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  // 3. Buy via bulk API
  blank();

  const progressRows = available.map((c) => ({
    cells: [fmt.domain(c.domain), c.price ? `${fmt.price(c.price.toFixed(2))}/yr` : ""],
    status: "pending" as const,
  }));

  const progress = createProgressTable(
    ["Domain", "Price"],
    progressRows,
    [30, 12],
    !useJson
  );

  progress.start();

  const res = await apiRequest("/api/domains/buy", {
    method: "POST",
    body: JSON.stringify({ domains: available.map((c) => c.domain) }),
  });
  const data = await res.json();

  // Mark results in progress table
  const succeededDomains = new Set((data.results || []).map((r: { domain: string }) => r.domain));
  const failedMap = new Map((data.errors || []).map((e: { domain: string; error: string }) => [e.domain, e.error]));

  for (let i = 0; i < available.length; i++) {
    const d = available[i].domain.toLowerCase().trim();
    if (succeededDomains.has(d)) {
      progress.markDone(i, S.success);
    } else {
      progress.markDone(i, S.error);
    }
  }

  progress.stop();

  if (useJson) {
    jsonOut(data, options.fields);
    return;
  }

  blank();

  const succeeded = data.summary?.succeeded ?? 0;
  const failed = data.summary?.failed ?? 0;

  if (succeeded > 0) {
    console.log(`  ${S.success} ${pc.green(`${succeeded} domain${succeeded > 1 ? "s" : ""} registered`)}`);
  }
  if (failed > 0) {
    console.log(`  ${S.error} ${pc.red(`${failed} failed`)}`);
    for (const e of data.errors || []) {
      console.log(`    ${pc.dim("─")} ${fmt.domain(e.domain)}: ${pc.dim(e.error)}${e.hint ? ` ${pc.dim(`(${e.hint})`)}` : ""}`);
    }
  }

  blank();
  if (succeeded > 0) {
    hintCommand("Configure DNS:", `domani dns <domain>`);
    blank();
  }
}

/* ── Exported command ──────────────────────────────────────── */

export async function buy(
  domainsArg: string[],
  options: { yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  let domains = domainsArg.filter(Boolean);

  if (domains.length === 0) {
    if (!isTTY) {
      fail("Missing required argument: domain(s)", {
        hint: "Usage: domani buy <domain> [domain2 ...]",
        code: "missing_argument",
        json: options.json,
      });
    }
    const input = await text({
      message: "Domain to purchase",
      placeholder: "e.g. myapp.dev (space-separated for multiple)",
    });
    if (isCancel(input) || !input) process.exit(0);
    domains = input.split(/\s+/).filter(Boolean);
  }

  if (domains.length === 1) {
    return buySingle(domains[0], options);
  }

  return buyBulk(domains, options);
}
