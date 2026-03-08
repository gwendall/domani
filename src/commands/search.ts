import { publicRequest } from "../api.js";
import { text, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, blank, hintCommand, createSpinner, jsonOut, fail, isTTY } from "../ui.js";
import { requireValidDomain, requireValidTlds } from "../validate.js";

interface SearchResult {
  domain: string;
  available: boolean;
  price: number;
  currency: string;
}

const BASIC_TLDS = ["com", "io", "dev", "ai", "sh", "co", "net", "org", "app", "xyz"];
const EXTENDED_TLDS = [
  ...BASIC_TLDS,
  "tech", "run", "cloud", "so", "code", "software",
  "pro", "one", "biz",
  "design", "studio", "art", "space", "lol", "site",
  "gg", "cc", "me", "tv", "fm",
  "1",
];

export async function search(
  domain: string | undefined,
  tldArgs: string[],
  options: { tlds?: string; maxPrice?: string; all?: boolean; expand?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  if (!domain) {
    if (!isTTY) {
      fail("Missing required argument: domain", {
        hint: "Usage: domani search <domain> [tlds...]",
        code: "missing_argument",
        json: options.json,
      });
    }
    const input = await text({
      message: "Search for a domain",
      placeholder: "e.g. myapp or myapp.dev",
    });
    if (isCancel(input) || !input) process.exit(0);
    domain = input;
  }
  // Validate & merge TLDs
  const positionalTlds = tldArgs.map((t) => t.replace(/^\./, ""));
  const flagTlds = options.tlds?.split(",").map((t) => t.trim()) || [];
  const mergedTlds = [...new Set([...positionalTlds, ...flagTlds])];
  if (mergedTlds.length > 0) requireValidTlds(mergedTlds, options);

  // Validate domain input
  requireValidDomain(domain, options);

  // Single domain check (domain.tld with no TLD filters)
  if (domain.includes(".") && mergedTlds.length === 0) {
    const s = createSpinner(!options.json);
    s.start(`Checking ${fmt.domain(domain)}`);

    // Fire search + OG in parallel - OG is only used if taken, costs nothing if available
    const [res, ogRes] = await Promise.all([
      publicRequest(`/api/domains/search?q=${encodeURIComponent(domain)}`),
      publicRequest(`/api/domains/${encodeURIComponent(domain)}/og`).catch(() => null),
    ]);
    const data = await res.json();

    if (!res.ok) {
      s.stop("Search failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }

    if (options.json) {
      // Normalize single-domain response to match bulk envelope shape
      const name = data.domain.split(".")[0];
      jsonOut({
        name,
        results: [data],
        total: 1,
        available: data.available ? 1 : 0,
      }, options.fields);
      return;
    }

    if (data.available) {
      s.stop(`${S.success} ${fmt.domain(data.domain)} ${S.dot} available ${S.dot} ${fmt.price(data.price)}/yr`);
      blank();
      hintCommand("Register it:", `domani buy ${data.domain}`);
      blank();
    } else {
      let ogTitle: string | undefined;
      try {
        if (ogRes?.ok) {
          const og = await ogRes.json();
          if (og?.title) ogTitle = og.title;
        }
      } catch {}
      const suffix = ogTitle ? ` ${S.dot} ${pc.dim(`"${ogTitle}"`)}` : "";
      s.stop(`${S.error} ${fmt.domain(data.domain)} ${S.dot} ${pc.red("taken")}${suffix}`);
    }
    return;
  }

  // Bulk search: streaming availability check
  const name = domain.split(".")[0];
  const tlds = mergedTlds.length > 0 ? mergedTlds : (options.expand ? EXTENDED_TLDS : BASIC_TLDS);
  const domains = tlds.map((tld) => `${name}.${tld}`);
  const params = new URLSearchParams();
  params.set("domains", domains.join(","));
  if (options.maxPrice) params.set("max_price", options.maxPrice);

  const s = createSpinner(!options.json);
  s.start(`Searching available domains for ${pc.bold(name)}`);

  const res = await publicRequest(`/api/domains/search?${params}`, {
    headers: { Accept: "text/event-stream" },
  });

  if (!res.ok) {
    s.stop("Search failed");
    try {
      const data = await res.json();
      fail(data.error || data.message || `Server error (${res.status})`, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    } catch {
      fail(`Server error (${res.status})`, { status: res.status, json: options.json, fields: options.fields });
    }
  }

  const results: SearchResult[] = [];
  let headerPrinted = false;
  let received = 0;

  const showAll = options.all ?? false;

  function printHeader() {
    if (headerPrinted) return;
    headerPrinted = true;
    s.stop(`Checking TLDs for ${pc.bold(name)}`);
    blank();
  }

  function printResult(r: SearchResult) {
    printHeader();
    if (r.available) {
      console.log(`  ${S.success} ${fmt.domain(r.domain).padEnd(37)} ${fmt.price(r.price)}${pc.dim("/yr")}`);
    } else {
      console.log(`  ${S.error} ${pc.dim(r.domain.padEnd(38))} ${pc.red("taken")}`);
    }
  }

  function updateProgress() {
    if (!headerPrinted) {
      s.message(`Checking TLDs for ${pc.bold(name)} ${pc.dim(`(${received} checked)`)}`);
    }
  }

  // Parse SSE stream
  const body = res.body;
  if (!body) {
    s.stop("Search failed");
    fail("Empty response", { code: "error", json: options.json, fields: options.fields });
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7);
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (currentEvent === "result") {
          received++;
          if (data.available || showAll) {
            if (!options.json) printResult(data);
            results.push(data);
          } else if (!options.json) {
            updateProgress();
          }
        } else if (currentEvent === "done") {
          if (options.json) {
            results.sort((a, b) => a.price - b.price);
            jsonOut({ name, results, total: data.total, available: data.available }, options.fields);
            return;
          }
          // Print summary
          if (headerPrinted) {
            console.log(`  ${pc.dim("─".repeat(50))}`);
          }
          const taken = data.total - data.available;
          const popular = data.total >= 5 && taken / data.total >= 0.5;
          const summary = `Checked ${data.total} TLDs · ${data.available} available${popular ? " · popular name" : ""}`;
          console.log(`  ${pc.dim(summary)}`);
          if (data.available === 0 && !options.expand && mergedTlds.length === 0) {
            blank();
            hintCommand("Try more TLDs:", `domani search ${name} --expand`);
          }
        }
      }
    }
  }

  blank();
}
