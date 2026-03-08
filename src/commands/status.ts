import { apiRequest } from "../api.js";
import pc from "picocolors";
import {
  S,
  fmt,
  heading,
  row,
  blank,
  hintCommand,
  createSpinner,
  createProgressTable,
  jsonOut,
  fail,
} from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
  propagated?: boolean;
}

function recordCells(r: DnsRecord): string[] {
  return [
    pc.yellow(r.type),
    r.name,
    pc.cyan(r.value) + (r.priority ? pc.dim(` pri=${r.priority}`) : ""),
  ];
}

function showInfo(data: { domain: string; status: string; expires?: string; days_until_expiry?: number }): void {
  heading(`Status ${fmt.domain(data.domain)}`);

  if (data.expires) {
    const expiry = new Date(data.expires).toLocaleDateString();
    const days = data.days_until_expiry;
    const color = days != null && days < 30 ? pc.red : days != null && days < 90 ? pc.yellow : pc.green;
    row("Expires", `${expiry} ${pc.dim("(")}${color(`${days} days`)}${pc.dim(")")}`);
  }
}

export async function status(
  domain: string | undefined,
  options: { json?: boolean; fields?: string; timeout?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);
  // JSON mode: regular request, no streaming
  if (options.json) {
    const s = createSpinner(false);
    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/status`);
    const data = await res.json();
    if (!res.ok) {
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }
    jsonOut(data, options.fields);
    return;
  }

  // Interactive mode: SSE stream with progress table
  const s = createSpinner(true);
  s.start(`Checking ${fmt.domain(domain)}`);

  let res: Response;
  try {
    res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/status`, {
      headers: { Accept: "text/event-stream" },
      signal: AbortSignal.timeout(options.timeout ? parseInt(options.timeout, 10) * 1000 : 30_000),
    });
  } catch {
    s.stop("Failed");
    fail("Request timed out", { hint: "The status check took too long. Try again.", code: "timeout", json: options.json, fields: options.fields });
  }

  if (!res.ok) {
    s.stop("Failed");
    try {
      const data = await res.json();
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    } catch {
      fail(`Server error (${res.status})`, { status: res.status, json: options.json, fields: options.fields });
    }
  }

  const body = res.body;
  if (!body) {
    s.stop("Failed");
    fail("Empty response");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let pt: ReturnType<typeof createProgressTable> | null = null;
  let records: DnsRecord[] = [];
  let spinnerStopped = false;

  try {
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

          if (currentEvent === "info") {
            s.stop("Status retrieved");
            spinnerStopped = true;
            showInfo(data);
          }

          if (currentEvent === "records") {
            records = data;
            if (records.length > 0) {
              blank();
              console.log(`  ${pc.bold("DNS Records")}`);
              const colWidths = [8, 10, 34];
              pt = createProgressTable(
                ["Type", "Name", "Value"],
                records.map((r) => ({
                  cells: recordCells(r),
                  status: "pending" as const,
                })),
                colWidths
              );
              pt.start();
            } else {
              blank();
              row("DNS", pc.dim("no records"));
              hintCommand("Auto-configure DNS:", `domani connect ${domain}`);
            }
          }

          if (currentEvent === "propagation" && pt) {
            const { index, propagated } = data;
            const icon = propagated ? S.success : `${S.warning}`;
            pt.markDone(index, icon);
          }

          if (currentEvent === "done") {
            if (pt) pt.stop();
          }

          if (currentEvent === "error") {
            if (!spinnerStopped) s.stop("Failed");
            if (pt) pt.stop();
            fail(data.message || "Status check failed");
          }
        }
      }
    }
  } catch {
    if (!spinnerStopped) s.stop("Failed");
    if (pt) pt.stop();
    fail("Connection lost", { hint: "The status check was interrupted. Try again.", code: "connection_lost", json: options.json, fields: options.fields });
  }

  // Safety net: stop spinner if stream ended without info event
  if (!spinnerStopped) s.stop("Done");

  blank();
}
