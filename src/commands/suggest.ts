import { publicRequest } from "../api.js";
import { text, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, blank, hintCommand, createSpinner, jsonOut, fail, isTTY } from "../ui.js";
import { requireValidTlds } from "../validate.js";

interface SuggestedDomain {
  domain: string;
  available: boolean;
  price: number;
  currency: string;
  reason?: string;
}

export async function suggest(
  prompt: string | undefined,
  options: { count?: string; tlds?: string; style?: string; lang?: string; json?: boolean; fields?: string; timeout?: string }
): Promise<void> {
  if (!prompt) {
    if (!isTTY) {
      fail("Missing required argument: prompt", {
        hint: "Usage: domani suggest \"describe your project\"",
        code: "missing_argument",
        json: options.json,
      });
    }
    const input = await text({
      message: "Describe your project or idea",
      placeholder: "e.g. AI coding assistant, pet food delivery...",
    });
    if (isCancel(input) || !input) process.exit(0);
    prompt = input;
  }

  const params = new URLSearchParams({ prompt });
  if (options.count) params.set("count", options.count);
  if (options.tlds) params.set("tlds", options.tlds);
  if (options.tlds) requireValidTlds(options.tlds.split(",").map(t => t.trim()), options);
  if (options.style) params.set("style", options.style);
  if (options.lang) params.set("lang", options.lang);

  // JSON mode: single request, wait for full result
  if (options.json) {
    const s = createSpinner(false);
    s.start("Finding available domains");

    const timeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : 60_000;
    let res: Response;
    try {
      res = await publicRequest(`/api/domains/suggest?${params}`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      s.stop("Failed");
      fail("Request timed out", { hint: `Suggest took too long. Try --timeout <seconds> to increase.`, code: "timeout", json: options.json, fields: options.fields });
    }
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }

    jsonOut(data, options.fields);
    return;
  }

  // SSE mode: stream results as they arrive
  const s = createSpinner(true);
  s.start("Finding available domains");

  const sseTimeoutMs = options.timeout ? parseInt(options.timeout, 10) * 1000 : 60_000;
  let res: Response;
  try {
    res = await publicRequest(`/api/domains/suggest?${params}`, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(sseTimeoutMs),
    });
  } catch {
    s.stop("Failed");
    fail("Request timed out", { hint: `Suggest took too long. Try --timeout <seconds> to increase.`, code: "timeout" });
  }

  if (!res.ok) {
    s.stop("Failed");
    try {
      const data = await res.json();
      fail(data.error || data.message || `Server error (${res.status})`, { hint: data.hint, status: res.status });
    } catch {
      fail(`Server error (${res.status})`, { status: res.status });
    }
  }

  const body = res.body;
  if (!body) {
    s.stop("Failed");
    fail("Empty response");
  }

  const available: SuggestedDomain[] = [];
  const taken: SuggestedDomain[] = [];
  let headerPrinted = false;
  let received = 0;

  function printHeader() {
    if (headerPrinted) return;
    headerPrinted = true;
    s.stop(`Finding available domains`);
    blank();
  }

  // Parse SSE stream - collect results, print at end (available first, then taken)
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
        try {
          const data = JSON.parse(line.slice(6));
          if (currentEvent === "result") {
            received++;
            if (data.available) {
              available.push(data);
            } else {
              taken.push(data);
            }
            if (!headerPrinted) {
              s.message(`Finding available domains ${pc.dim(`(${received} checked, ${available.length} available)`)}`);
            }
          } else if (currentEvent === "iteration") {
            if (!headerPrinted) {
              s.message(`Finding available domains ${pc.dim(`(round ${data.n})`)}`);
            }
          } else if (currentEvent === "done") {
            printHeader();

            // Print available first
            for (const item of available) {
              const reasonHint = item.reason ? `  ${pc.dim(item.reason)}` : "";
              console.log(`  ${S.success} ${fmt.domain(item.domain).padEnd(37)} ${fmt.price(item.price)}${pc.dim("/yr")}${reasonHint}`);
            }
            // Then taken
            for (const item of taken) {
              console.log(`  ${S.error} ${pc.dim(item.domain.padEnd(38))} ${pc.red("taken")}`);
            }

            console.log(`  ${pc.dim("─".repeat(50))}`);
            console.log(`  ${pc.dim(`Found ${data.total} available · checked ${data.checked} · ${data.iterations} round${data.iterations > 1 ? "s" : ""}`)}`);
          } else if (currentEvent === "error") {
            if (!headerPrinted) s.stop("Failed");
            fail(data.message);
          }
        } catch {
          // skip malformed JSON
        }
      }
    }
  }

  if (available.length === 0 && taken.length === 0) {
    if (!headerPrinted) s.stop("No results");
    fail("Could not find available domains for this prompt.");
  }

  blank();
  if (available.length > 0) {
    hintCommand("Register one:", `domani buy ${available[0].domain}`);
    blank();
  }
}
