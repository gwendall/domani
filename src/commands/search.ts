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
  error?: boolean;
}

const BATCH_SIZE = 10;

// Curated priority order — most desirable TLDs searched first, regardless of price
const PRIORITY_TLDS = [
  // Tier 1 — universally recognized
  "com", "io", "ai", "dev", "app", "co",
  // Tier 2 — widely used generics
  "net", "org", "xyz", "sh", "me", "cc",
  // Tier 3 — strong tech/startup
  "tech", "run", "cloud", "so", "gg", "fm", "tv", "pro", "one",
  // Tier 4 — business entity
  "inc", "ltd", "llc", "biz", "group", "global", "ventures", "capital", "fund", "agency",
  // Tier 5 — product/commerce
  "store", "shop", "market", "sale", "deals", "auction", "trade",
  // Tier 6 — creative/design
  "studio", "design", "art", "space", "style", "fashion", "luxury", "brand", "media", "digital",
  // Tier 7 — web presence
  "site", "online", "live", "show", "world", "zone", "land", "place", "city", "town",
  // Tier 8 — content/social
  "blog", "news", "social", "chat", "link", "page", "fun", "lol", "meme", "wtf",
  // Tier 9 — dev/tools
  "tools", "build", "works", "work", "team", "solutions", "services", "systems", "network", "software",
  // Tier 10 — entertainment
  "music", "video", "photo", "photos", "game", "games", "club", "stream", "film", "movie",
  // Tier 11 — food/hospitality
  "pizza", "coffee", "beer", "bar", "pub", "restaurant", "cafe", "kitchen", "food", "wine",
  // Tier 12 — health/wellness
  "health", "care", "clinic", "dental", "fitness", "yoga", "bio", "life", "lifestyle",
  // Tier 13 — finance/legal
  "finance", "money", "legal", "law", "cash",
  // Tier 14 — knowledge/education
  "academy", "university", "education", "training", "courses", "science", "wiki", "guide",
  // Tier 15 — country codes (popular)
  "us", "uk", "eu", "ca", "au", "de", "fr", "it", "es", "nl", "jp", "sg", "nz", "mx",
  // Tier 16 — real estate/local
  "house", "homes", "realty", "estate", "garden", "nyc", "london", "berlin", "paris",
  // Tier 17 — misc popular
  "guru", "ninja", "rocks", "fail", "party", "vip", "gold", "black", "pink", "red",
  "events", "travel", "sport", "jobs", "careers", "consulting", "energy", "eco", "green",
  "support", "help", "info", "new", "now", "today", "day",
];

let _allTlds: string[] | null = null;

async function fetchAllTlds(): Promise<string[]> {
  if (_allTlds) return _allTlds;
  try {
    const res = await publicRequest("/api/tlds?sort=price&order=asc&limit=1000");
    if (res.ok) {
      const data = await res.json();
      const apiTlds = (data.tlds as Array<{ tld: string }>).map((t) => t.tld);
      if (apiTlds.length > 0) {
        // Priority TLDs first (filtered to those the API supports), then the rest by price
        const prioritySet = new Set(PRIORITY_TLDS);
        const apiSet = new Set(apiTlds);
        const ranked = [
          ...PRIORITY_TLDS.filter((t) => apiSet.has(t)),
          ...apiTlds.filter((t) => !prioritySet.has(t)),
        ];
        _allTlds = ranked;
        return ranked;
      }
    }
  } catch {}
  _allTlds = PRIORITY_TLDS;
  return PRIORITY_TLDS;
}

/** Live interactive select that renders as SSE results stream in. */
async function liveSelectSearch(
  body: AsyncIterable<Uint8Array>,
  name: string,
  showAll: boolean,
  canLoadMore: boolean,
  allTlds: string[],
): Promise<{ chosen: string | null; chosenResult: SearchResult | null; searchAgain: boolean; allTaken: boolean; expanded: boolean }> {
  const items: SearchResult[] = [];
  const takenItems: SearchResult[] = [];
  let displayLimit = BATCH_SIZE; // show at most this many items; extras buffered for next page
  let selectedIndex = 0;
  let streaming = true;
  let renderedLines = 0;
  let total = 0;
  let availableCount = 0;
  let batchIndex = 0; // how many TLD_BATCHES have been loaded
  let pendingMore = false;
  let done = false;
  let selectedValue: string | null = null;
  let lastChecked = "";
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let spinnerFrame = 0;

  // Only advances the spinner frame — render() is called directly by stream/keys
  const renderLoop = setInterval(() => {
    if (done || !streaming) return;
    spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
    render();
  }, 80);

  function clearRendered() {
    if (renderedLines > 0) {
      process.stdout.write(`\x1B[${renderedLines}A\x1B[0J`);
      renderedLines = 0;
    }
  }

  // Options after domain items: [more?] [new search] [skip]
  function extras(): Array<"more" | "new" | "skip"> {
    if (streaming) return [];
    const loaded = BATCH_SIZE + batchIndex * BATCH_SIZE;
    const hasMore = (items.length > displayLimit) || (canLoadMore && loaded < allTlds.length);
    return hasMore ? ["more", "new", "skip"] : ["new", "skip"];
  }

  function visibleItems(): SearchResult[] {
    return items.slice(0, displayLimit);
  }

  function maxIdx(): number {
    const e = extras();
    return Math.max(0, visibleItems().length + e.length - 1);
  }

  const TAKEN_PREVIEW = 6;

  function render() {
    clearRendered();
    const lines: string[] = [];
    // When no available results, fall back to showing taken ones (dimmed, non-selectable)
    const visible = visibleItems();
    const showTaken = !streaming && visible.length === 0 && takenItems.length > 0;
    const displayItems = showTaken ? takenItems.slice(0, TAKEN_PREVIEW) : visible;
    const maxLen = displayItems.reduce((m, i) => Math.max(m, i.domain.length), 0);
    const ex = extras();

    for (let i = 0; i < displayItems.length; i++) {
      const item = displayItems[i];
      if (showTaken) {
        lines.push(`${pc.dim("│")}  ${pc.dim("✕")} ${pc.dim(item.domain.padEnd(maxLen))}  ${pc.dim("taken")}`);
      } else {
        const sel = i === selectedIndex;
        const dot = sel ? pc.green("●") : pc.dim("○");
        const padded = item.domain.padEnd(maxLen);
        const domain = sel ? pc.bold(pc.cyan(padded)) : padded;
        const price = pc.dim(`$${item.price}/yr`);
        lines.push(`${pc.dim("│")}  ${dot} ${domain}  ${price}`);
      }
    }
    if (showTaken && takenItems.length > TAKEN_PREVIEW) {
      lines.push(`${pc.dim("│")}  ${pc.dim(`… and ${takenItems.length - TAKEN_PREVIEW} more taken`)}`);
    }

    if (streaming) {
      const hint = lastChecked ? pc.dim(`checking ${lastChecked}…`) : pc.dim("searching…");
      lines.push(`${pc.dim("│")}  ${pc.cyan(spinnerFrames[spinnerFrame])} ${hint}`);
    } else {
      const totalLoaded = BATCH_SIZE + batchIndex * BATCH_SIZE;
      const allExhausted = canLoadMore && totalLoaded >= allTlds.length;
      if (allExhausted) {
        lines.push(`${pc.dim("│")}  ${pc.dim(`All ${Math.min(totalLoaded, allTlds.length)} TLDs searched`)}`);
      }
      for (let j = 0; j < ex.length; j++) {
        const idx = visibleItems().length + j;
        const sel = idx === selectedIndex;
        const dot = sel ? pc.green("●") : pc.dim("○");
        const label = ex[j] === "more" ? pc.dim("More →") : ex[j] === "new" ? pc.dim("New search →") : pc.dim("Skip");
        lines.push(`${pc.dim("│")}  ${dot} ${label}`);
      }
      lines.push(pc.dim("└"));
    }

    process.stdout.write(lines.join("\n") + "\n");
    renderedLines = lines.length;
  }

  // Print clack-style prompt header
  process.stdout.write(`${pc.cyan("◆")}  Register a domain?\n`);
  process.stdout.write("\x1B[?25l"); // hide cursor
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const keyHandler = (data: Buffer) => {
    const key = data.toString();
    if (key === "\u001b[A") {
      selectedIndex = Math.max(0, selectedIndex - 1);
      render();
    } else if (key === "\u001b[B") {
      selectedIndex = Math.min(maxIdx(), selectedIndex + 1);
      render();
    } else if (key === "\r") {
      const vis = visibleItems();
      if (streaming && vis.length === 0) return;
      if (selectedIndex < vis.length) {
        selectedValue = vis[selectedIndex]?.domain ?? null;
        done = true;
      } else {
        const ex = extras();
        const action = ex[selectedIndex - vis.length];
        if (action === "more") {
          displayLimit += BATCH_SIZE;
          // Only fetch from API if we don't already have buffered results
          if (items.length < displayLimit) pendingMore = true;
          else { selectedIndex = Math.min(selectedIndex, maxIdx()); render(); }
        } else if (action === "new") {
          selectedValue = "__new__";
          done = true;
        } else {
          done = true; // skip
        }
      }
    } else if (key === "\u0003" || key === "\u001b") {
      done = true;
    }
  };

  process.stdin.on("data", keyHandler);
  render();

  async function runStream(streamBody: AsyncIterable<Uint8Array>) {
    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";
    for await (const chunk of streamBody) {
      if (done) break;
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          currentEvent = line.slice(7);
        } else if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === "result") lastChecked = data.domain;
          if (currentEvent === "result" && (data.available || showAll)) {
            if (batchIndex === 0) {
              const insertAt = items.findIndex((i) => i.price > data.price);
              if (insertAt === -1) {
                items.push(data);
              } else {
                items.splice(insertAt, 0, data);
                if (insertAt <= selectedIndex) selectedIndex++;
              }
            } else {
              items.push(data);
            }
            render();
          } else if (currentEvent === "result" && !data.available && !data.error) {
            if (takenItems.length < 8) takenItems.push(data);
          } else if (currentEvent === "done") {
            total += data.total;
            availableCount += data.available;
            streaming = false;
            selectedIndex = Math.min(selectedIndex, maxIdx());
            // Auto-load next batch until we have BATCH_SIZE results or exhaust all TLDs
            const loaded = BATCH_SIZE + batchIndex * BATCH_SIZE;
            if (items.length < displayLimit && canLoadMore && loaded < allTlds.length) {
              pendingMore = true;
            }
            // Skip render if we're about to load more (avoids flashing empty list)
            if (!pendingMore) render();
          }
        }
      }
    }
    streaming = false;
  }

  await runStream(body);

  // Wait for user interactions (may trigger "More")
  while (!done) {
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (done || pendingMore) { clearInterval(interval); resolve(); }
      }, 16);
    });

    if (pendingMore && !done) {
      pendingMore = false;
      const start = BATCH_SIZE + batchIndex * BATCH_SIZE;
      const batch = allTlds.slice(start, start + BATCH_SIZE);
      batchIndex++;
      streaming = true;
      selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
      render();

      const params = new URLSearchParams();
      params.set("domains", batch.map((t) => `${name}.${t}`).join(","));
      try {
        const moreRes = await publicRequest(`/api/domains/search?${params}`, {
          headers: { Accept: "text/event-stream" },
        });
        if (moreRes.ok && moreRes.body) {
          await runStream(moreRes.body as AsyncIterable<Uint8Array>);
        } else {
          streaming = false;
          render();
        }
      } catch {
        streaming = false;
        render();
      }
    }
  }

  clearInterval(renderLoop);
  process.stdin.removeListener("data", keyHandler);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1B[?25h"); // show cursor

  clearRendered();

  const searchAgain = selectedValue === "__new__";
  const chosen = searchAgain ? null : selectedValue;
  const chosenResult = chosen ? (items.find((r) => r.domain === chosen) ?? null) : null;

  if (chosen) {
    process.stdout.write(`${pc.dim("◇")}  Register a domain?\n${pc.dim("│")}  ${pc.bold(pc.cyan(chosen))}\n${pc.dim("└")}\n`);
  } else {
    process.stdout.write(`${pc.dim("└")}\n`);
  }

  return { chosen, chosenResult, searchAgain, allTaken: items.length === 0 && takenItems.length > 0, expanded: batchIndex > 0 };
}

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
      if (isTTY && !options.json) {
        const { buy } = await import("./buy.js");
        await buy([data.domain], { preChecked: { price: data.price, currency: data.currency } });
      } else {
        blank();
        hintCommand("Register it:", `domani buy ${data.domain}`);
        blank();
      }
    } else if (data.error) {
      s.stop(`${pc.dim("?")} ${fmt.domain(data.domain)} ${S.dot} ${pc.dim("lookup failed")}`);
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
  let currentName = domain.split(".")[0];

  // TTY + specific TLDs: flat list output then buy prompt
  if (isTTY && !options.json && mergedTlds.length > 0) {
    const params = new URLSearchParams();
    params.set("domains", mergedTlds.map((tld) => `${currentName}.${tld}`).join(","));
    if (options.maxPrice) params.set("max_price", options.maxPrice);

    const res = await publicRequest(`/api/domains/search?${params}`, {
      headers: { Accept: "text/event-stream" },
    });
    if (!res.ok || !res.body) { fail("Search failed", { json: options.json }); return; }

    const allResults: SearchResult[] = [];
    const decoder = new TextDecoder();
    let buf = "";
    let evt = "";

    const s = createSpinner(true);
    s.start(`Checking ${mergedTlds.length} TLD${mergedTlds.length > 1 ? "s" : ""}`);

    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          evt = line.slice(7);
        } else if (line.startsWith("data: ") && evt === "result") {
          allResults.push(JSON.parse(line.slice(6)));
        }
      }
    }

    s.stop("");

    const col = Math.max(...mergedTlds.map((t) => `${currentName}.${t}`.length)) + 2;
    const available = allResults.filter((r) => r.available);
    const taken = allResults.filter((r) => !r.available && !r.error);

    for (const r of [...available, ...taken]) {
      if (r.available) {
        console.log(`  ${pc.green("✓")} ${pc.bold(pc.white(r.domain.padEnd(col)))} ${pc.green(fmt.price(r.price) + "/yr")}`);
      } else {
        console.log(`  ${pc.dim("✗")} ${pc.dim(r.domain.padEnd(col))} ${pc.dim("taken")}`);
      }
    }

    if (available.length === 0) {
      console.log(`  ${pc.dim("No domains available")}`);
      blank();
      return;
    }

    const { buy } = await import("./buy.js");

    if (available.length === 1) {
      await buy([available[0].domain], { preChecked: { price: available[0].price, currency: available[0].currency } });
      return;
    }

    // Multiple available: let user pick one
    const { select, isCancel: selIsCancel } = await import("@clack/prompts");
    const picked = await select({
      message: "Register one?",
      options: [
        ...available.map((r) => ({ value: r.domain, label: fmt.domain(r.domain), hint: fmt.price(r.price) + "/yr" })),
        { value: "__skip__", label: "Skip" },
      ],
    });
    if (!selIsCancel(picked) && picked !== "__skip__") {
      blank();
      const chosenResult = available.find((r) => r.domain === picked);
      await buy([picked as string], { preChecked: chosenResult ? { price: chosenResult.price, currency: chosenResult.currency } : undefined });
    } else {
      blank();
    }
    return;
  }

  // TTY + open search: live interactive select (loops on "New search")
  if (isTTY && !options.json) {
    const allTlds = await fetchAllTlds();
    while (true) {
      const tlds = options.expand ? allTlds : allTlds.slice(0, BATCH_SIZE);
      const params = new URLSearchParams();
      params.set("domains", tlds.map((tld) => `${currentName}.${tld}`).join(","));
      if (options.maxPrice) params.set("max_price", options.maxPrice);

      const s = createSpinner(true);
      s.start(`Searching available domains for ${pc.bold(currentName)}`);
      const res = await publicRequest(`/api/domains/search?${params}`, {
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) { s.stop("Search failed"); break; }
      s.stop("");

      const canLoadMore = !options.expand;
      const { chosen, chosenResult, searchAgain } = await liveSelectSearch(
        res.body as AsyncIterable<Uint8Array>,
        currentName,
        options.all ?? false,
        canLoadMore,
        allTlds,
      );

      if (chosen) {
        blank();
        const { buy } = await import("./buy.js");
        const preChecked = chosenResult ? { price: chosenResult.price, currency: chosenResult.currency } : undefined;
        await buy([chosen], { preChecked });
        return;
      }

      if (!searchAgain) break;

      const { text: promptText, isCancel: promptIsCancel } = await import("@clack/prompts");
      const input = await promptText({ message: "Search for a domain", placeholder: "e.g. myapp or myapp.dev" });
      if (promptIsCancel(input) || !input) break;
      currentName = (input as string).split(".")[0];
    }
    blank();
    return;
  }

  const name = currentName;
  const allTldsForNonTty = await fetchAllTlds();
  const tlds = mergedTlds.length > 0 ? mergedTlds : (options.expand ? allTldsForNonTty : allTldsForNonTty.slice(0, BATCH_SIZE));
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

  const body = res.body;
  if (!body) {
    s.stop("Search failed");
    fail("Empty response", { code: "error", json: options.json, fields: options.fields });
  }

  // Non-TTY / JSON: stream and print results
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
    } else if (r.error) {
      // skip — TLD lookup failed, don't show as taken
    } else {
      console.log(`  ${S.error} ${pc.dim(r.domain.padEnd(38))} ${pc.red("taken")}`);
    }
  }

  function updateProgress() {
    if (!headerPrinted) {
      s.message(`Checking TLDs for ${pc.bold(name)} ${pc.dim(`(${received} checked)`)}`);
    }
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

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
