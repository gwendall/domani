import { apiRequest } from "../api.js";
import { confirm as clackConfirm, select, isCancel, text, type TextOptions } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, blank, hintCommand, createSpinner, createProgressTable, jsonOut, skipConfirm, dryRunOut, fail, isTTY, asAccount } from "../ui.js";
import { actingAsLabel } from "../config.js";
import { requireValidDomain, requireValidDomains } from "../validate.js";
import { acceptNewPrice, parseMaxPrice, priceToAccept, roundToCent } from "../max-price.js";
import { renewalDiffers } from "../per-year.js";
import { belowMinimum, longerTerms, termFields, termOf, termPhrase, termPrice, yearsLabel, type PriceQuote } from "../term.js";
import { failBelowMinimum, failBuy, requestedYears } from "./buy-term.js";

interface BuyOptions {
  yes?: boolean;
  dryRun?: boolean;
  json?: boolean;
  fields?: string;
  maxPrice?: string;
  years?: string;
  preChecked?: PriceQuote & { price: number; currency: string; marketplace?: boolean };
}

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

type PurchaseOutcome =
  | { registered: Record<string, unknown> }
  | { refused: { price: number; error?: string; renewal_price?: unknown; listed_price?: unknown } };

/** One streamed purchase for `years` (the TLD's minimum when undefined), charging no more than maxPrice. */
async function purchaseOne(domain: string, years: number | undefined, maxPrice: number | undefined, label: string, options: BuyOptions): Promise<PurchaseOutcome> {
  const p = createSpinner(!options.json);
  p.start(label);

  const res = await apiRequest("/api/domains/buy", {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: JSON.stringify({ domain, ...(years !== undefined ? { years } : {}), ...(maxPrice !== undefined ? { max_price: maxPrice } : {}) }),
  });

  if (!res.ok || !res.body) {
    const errData = await res.json().catch(() => ({}));
    const price = priceToAccept(errData);
    if (price !== undefined) {
      p.stop("Price changed - nothing was charged");
      return { refused: { price, error: errData.error, renewal_price: errData.renewal_price, listed_price: errData.listed_price } };
    }
    p.stop("Purchase failed");
    failBuy(errData, res.status, options);
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
        else if (evt === "available" && typeof payload.years === "number") p.message(`Buying ${fmt.domain(payload.domain ?? domain)} for ${yearsLabel(payload.years)}`);
        else if (evt === "payment") p.message(`Charging ${fmt.price(payload.total)}`);
        else if (evt === "registering") p.message(`Registering ${fmt.domain(payload.domain)}`);
        else if (evt === "registered") data = payload;
        else if (evt === "error") {
          const price = priceToAccept(payload);
          if (price !== undefined) {
            p.stop("Price changed - nothing was charged");
            return { refused: { price, error: payload.error, renewal_price: payload.renewal_price, listed_price: payload.listed_price } };
          }
          p.stop("Purchase failed");
          failBuy(payload, res.status, options);
        }
      }
    }
  }

  const term = typeof data.years === "number" ? pc.dim(` · ${yearsLabel(data.years)}`) : "";
  const expires = data.expires ? pc.dim(` · expires ${new Date(data.expires as string).toLocaleDateString()}`) : "";
  p.stop(`${S.success} ${fmt.domain(data.domain as string)} is yours!${term}${expires}`);
  return { registered: data };
}

async function buySingle(domain: string, options: BuyOptions): Promise<void> {
  requireValidDomain(domain, options);
  const requested = parseMaxPrice(options.maxPrice, options);
  const years = requestedYears(options);

  let searchData: PriceQuote & { available: boolean; price: number; currency: string; error?: string; hint?: string };
  const s = createSpinner(!options.json && !options.preChecked);

  if (options.preChecked) {
    searchData = { available: true, ...options.preChecked };
  } else {
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
  }

  // Each TLD is bought for its minimum term unless --years says otherwise; one below it is refused before any call.
  const refusal = belowMinimum(domain, searchData, years);
  const term = termOf(searchData, refusal ? undefined : years);
  s.stop(`${S.success} ${fmt.domain(domain)} ${S.dot} available ${S.dot} ${pc.green(termPrice(searchData, term))}`);
  if (refusal) failBelowMinimum([refusal], false, options);

  // The buy charges nothing above the total shown for the term, unless --max-price says otherwise.
  let ceiling = requested ?? (term.total !== undefined ? roundToCent(term.total) : undefined);

  if (options.dryRun) {
    return dryRunOut("buy", {
      ...(options.json ? {} : { purchase: `${domain} ${termPhrase(searchData, term)}` }),
      domain,
      available: true,
      price: searchData.price,
      ...(searchData.renewal_price !== undefined ? { renewal_price: searchData.renewal_price } : {}),
      ...termFields(term),
      currency: searchData.currency || "USD",
      max_price: ceiling,
      acting_as: actingAsLabel(),
    }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    const ok = await clackConfirm({
      message: `Purchase ${pc.bold(domain)} ${pc.green(termPhrase(searchData, term))}${asAccount()}?`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  const label = (total: number | undefined) => `Purchasing ${fmt.domain(domain)} for ${yearsLabel(term.years)}${total !== undefined ? `: ${fmt.price(total.toFixed(2))}` : ""}`;
  let outcome = await purchaseOne(domain, years, ceiling, label(term.total), options);
  while ("refused" in outcome) {
    const accepted = await acceptNewPrice(outcome.refused.price, ceiling ?? term.total ?? searchData.price, outcome.refused, "Buy", options);
    if (accepted === undefined) return;
    ceiling = accepted;
    outcome = await purchaseOne(domain, years, ceiling, label(accepted), options);
  }
  const data = outcome.registered;

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

async function buyBulk(domains: string[], options: BuyOptions): Promise<void> {
  requireValidDomains(domains, options);
  const requested = parseMaxPrice(options.maxPrice, options);
  const years = requestedYears(options);
  const useJson = !!options.json;

  // 1. Check availability for all domains first
  const s = createSpinner(!useJson);
  s.start(`Checking ${domains.length} domains`);

  const checks = await Promise.all(
    domains.map(async (d) => {
      try {
        const res = await apiRequest(`/api/domains/search?q=${encodeURIComponent(d)}`);
        const data = await res.json();
        return { domain: d, available: res.ok && data.available, price: data.price as number | undefined, renewal_price: data.renewal_price as number | undefined, min_years: data.min_years as number | undefined, min_term_price: data.min_term_price as number | undefined };
      } catch {
        return { domain: d, available: false, price: undefined, renewal_price: undefined };
      }
    })
  );

  const unavailable = checks.filter((c) => !c.available);

  if (checks.every((c) => !c.available)) {
    s.stop(`${S.error} None of the ${domains.length} domains are available`);
    process.exit(1);
  }

  // Each name at its TLD's minimum term unless --years says otherwise; one below its minimum is refused before any call.
  const refused = checks.filter((c) => c.available).map((c) => belowMinimum(c.domain, c, years)).filter((r) => r !== undefined);
  if (refused.length > 0) {
    s.stop(`${S.error} ${refused.length} domain${refused.length > 1 ? "s" : ""} cannot be registered for ${yearsLabel(years ?? 1)}`);
    failBelowMinimum(refused, true, options);
  }
  const available = checks.filter((c) => c.available).map((c) => ({ ...c, term: termOf(c, years) }));

  const total = roundToCent(available.reduce((sum, c) => sum + (c.term.total ?? 0), 0));
  // What the same names cost each year after the first: a name whose renewal is unknown counts its first-year price.
  const renewalTotal = available.reduce((sum, c) => sum + (c.renewal_price ?? c.price ?? 0), 0);
  const thenRenews = renewalDiffers(total, renewalTotal) ? `, then ${fmt.price(renewalTotal.toFixed(2))}/yr` : "";
  s.stop(`${S.success} ${available.length}/${domains.length} available ${S.dot} ${fmt.price(total.toFixed(2))} total`);

  if (unavailable.length > 0) {
    for (const u of unavailable) {
      console.log(`  ${S.error} ${fmt.domain(u.domain)} ${pc.dim("not available")}`);
    }
  }

  // The buy charges nothing above the total shown; a name shown without a price leaves the ceiling to the server.
  let ceiling = requested ?? (available.every((c) => c.term.total !== undefined) ? total : undefined);

  if (options.dryRun) {
    return dryRunOut("buy_bulk", {
      domains: available.map((c) => ({ domain: c.domain, price: c.price, ...(c.renewal_price !== undefined ? { renewal_price: c.renewal_price } : {}), ...termFields(c.term) })),
      unavailable: unavailable.map((c) => c.domain),
      total_price: parseFloat(total.toFixed(2)),
      max_price: ceiling,
      acting_as: actingAsLabel(),
    }, options.json, options.fields);
  }

  // 2. Confirm
  if (!skipConfirm(options)) {
    const ok = await clackConfirm({
      message: `Purchase ${pc.bold(String(available.length))} domain${available.length > 1 ? "s" : ""} for ${fmt.price(total.toFixed(2))}${longerTerms(available)}${thenRenews}${asAccount()}?`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  // 3. Buy via bulk API
  blank();

  let res: Response;
  let data;
  for (;;) {
    const progress = createProgressTable(
      ["Domain", "Price"],
      available.map((c) => ({
        cells: [fmt.domain(c.domain), c.price ? pc.green(termPrice(c, c.term)) : ""],
        status: "pending" as const,
      })),
      [30, 12],
      !useJson
    );
    progress.start();

    res = await apiRequest("/api/domains/buy", {
      method: "POST",
      body: JSON.stringify({ domains: available.map((c) => c.domain), ...(years !== undefined ? { years } : {}), ...(ceiling !== undefined ? { max_price: ceiling } : {}) }),
    });
    data = await res.json();

    const price = res.ok ? undefined : priceToAccept(data);
    if (price === undefined) {
      // Mark results in progress table
      const succeededDomains = new Set((data.results || []).map((r: { domain: string }) => r.domain));
      for (let i = 0; i < available.length; i++) {
        const d = available[i].domain.toLowerCase().trim();
        progress.markDone(i, succeededDomains.has(d) ? S.success : S.error);
      }
      progress.stop();
      break;
    }

    for (let i = 0; i < available.length; i++) progress.markDone(i, pc.dim("·"));
    progress.stop();
    blank();
    const accepted = await acceptNewPrice(price, ceiling ?? total, data, "Buy", options);
    if (accepted === undefined) return;
    ceiling = accepted;
    blank();
  }

  if (!res.ok) failBuy(data, res.status, options);

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

export async function buy(domainsArg: string[], options: BuyOptions): Promise<void> {
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
