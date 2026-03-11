import { apiRequest } from "../api.js";
import { confirm as clackConfirm, select, isCancel, text, type TextOptions } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, createProgressTable, jsonOut, skipConfirm, dryRunOut, fail, isTTY } from "../ui.js";
import { requireValidDomain, requireValidDomains } from "../validate.js";

async function nextSteps(domain: string): Promise<void> {
  const action = await select({
    message: `What's next for ${pc.cyan(domain)}?`,
    options: [
      { value: "connect", label: "Connect to a service", hint: "domani connect" },
      { value: "email", label: "Set up email", hint: "domani email setup" },
      { value: "dns", label: "Configure DNS", hint: "domani dns" },
      { value: "status", label: "Check status & DNS propagation", hint: "domani status" },
      { value: "done", label: "Done" },
    ],
  });
  if (isCancel(action) || action === "done") { blank(); return; }
  blank();
  if (action === "connect") { const { connect } = await import("./connect.js"); await connect(domain, undefined, {}); }
  else if (action === "email") {
    const slug = await text({ message: `Mailbox name for ${pc.cyan(domain)}`, placeholder: "e.g. hey, hello, contact" } as TextOptions);
    if (isCancel(slug) || !slug) { blank(); return; }
    blank();
    const { email } = await import("./email.js");
    await email("create", undefined, { domain, slug: slug as string });
  }
  else if (action === "dns") { const { dns } = await import("./dns.js"); await dns(domain); }
  else if (action === "status") { const { status } = await import("./status.js"); await status(domain, {}); }
}

/* ── Single domain buy (original flow) ─────────────────────── */

async function buySingle(
  domain: string,
  options: { yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string; preChecked?: { price: number; currency: string } }
): Promise<void> {
  requireValidDomain(domain, options);

  let searchData: { available: boolean; price: number; currency: string };

  if (options.preChecked) {
    searchData = { available: true, ...options.preChecked };
  } else {
    const s = createSpinner(!options.json);
    s.start(`Checking ${fmt.domain(domain)}`);
    const searchRes = await apiRequest(`/api/domains/search?q=${encodeURIComponent(domain)}`);
    searchData = await searchRes.json();
    if (!searchRes.ok) {
      s.stop("Search failed");
      fail(searchData.error, { hint: searchData.hint, status: searchRes.status, json: options.json, fields: options.fields });
    }
    if (!searchData.available) {
      s.stop(`${S.error} ${fmt.domain(domain)} is not available`);
      fail(`${domain} is not available`, { code: "not_available", json: options.json, fields: options.fields });
    }
    s.stop(`${S.success} ${fmt.domain(domain)} ${S.dot} available ${S.dot} ${fmt.price(searchData.price)}/yr`);
  }

  if (options.dryRun) {
    return dryRunOut("buy", {
      domain,
      available: true,
      price: searchData.price,
      currency: searchData.currency || "USD",
    }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
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
    headers: { Accept: "text/event-stream" },
    body: JSON.stringify({ domain }),
  });

  if (!res.ok || !res.body) {
    p.stop("Purchase failed");
    const errData = await res.json().catch(() => ({}));
    fail(errData.error || errData.message, { hint: errData.hint, fixUrl: errData.setup_url || errData.payment_options?.card?.setup_url, status: res.status, json: options.json, fields: options.fields });
  }

  // Stream SSE events and show progress
  let data: Record<string, unknown> = {};
  const decoder = new TextDecoder();
  let buf = "";
  let evt = "";

  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        evt = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const payload = JSON.parse(line.slice(6));
        if (evt === "checking") p.message(`Checking ${fmt.domain(payload.domain)}`);
        else if (evt === "payment") p.message(`Charging ${fmt.price(payload.total)}`);
        else if (evt === "registering") p.message(`Registering ${fmt.domain(payload.domain)}`);
        else if (evt === "registered") data = payload;
        else if (evt === "error") {
          p.stop("Purchase failed");
          fail(payload.error, { hint: payload.hint, fixUrl: payload.setup_url, status: res.status, json: options.json, fields: options.fields });
        }
      }
    }
  }

  const expires = data.expires ? pc.dim(` · expires ${new Date(data.expires as string).toLocaleDateString()}`) : "";
  p.stop(`${S.success} ${fmt.domain(data.domain as string)} is yours!${expires}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  if (isTTY) {
    await nextSteps(data.domain as string);
  } else {
    hintCommand("Connect to a service:", `domani connect ${data.domain}`);
    hintCommand("Set up email:", `domani email setup ${data.domain}`);
    hintCommand("Configure DNS:", `domani dns ${data.domain}`);
    blank();
  }
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
  if (succeeded > 0 && isTTY) {
    const succeededDomains: string[] = (data.results || [])
      .filter((r: { domain: string; success: boolean }) => r.success)
      .map((r: { domain: string }) => r.domain);
    if (succeededDomains.length === 1) {
      await nextSteps(succeededDomains[0]);
    } else {
      const picked = await select({
        message: "Set up one of your new domains?",
        options: [
          ...succeededDomains.map((d: string) => ({ value: d, label: pc.cyan(d) })),
          { value: "done", label: "Done" },
        ],
      });
      if (!isCancel(picked) && picked !== "done") {
        blank();
        await nextSteps(picked as string);
      } else {
        blank();
      }
    }
  } else if (succeeded > 0) {
    hintCommand("Connect to a service:", `domani connect <domain>`);
    hintCommand("Set up email:", `domani email setup <domain>`);
    blank();
  }
}

/* ── Exported command ──────────────────────────────────────── */

export async function buy(
  domainsArg: string[],
  options: { yes?: boolean; dryRun?: boolean; json?: boolean; fields?: string; preChecked?: { price: number; currency: string } }
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
