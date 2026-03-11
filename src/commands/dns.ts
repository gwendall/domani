import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, table, createSpinner, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function dns(
  domain: string | undefined,
  action?: string,
  typeArg?: string,
  nameArg?: string,
  valueArg?: string,
  options?: { dryRun?: boolean; json?: boolean; fields?: string; type?: string; name?: string; value?: string; file?: string }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);
  const jsonOutput = options?.json ?? false;

  // Merge flags with positional args (flags take priority)
  const type = options?.type || typeArg;
  const name = options?.name || nameArg;
  const value = options?.value || valueArg;

  // ── GET ──────────────────────────────────────────────
  if (!action || action === "get") {
    const s = createSpinner(!jsonOutput);
    s.start(`Loading DNS for ${fmt.domain(domain)}`);

    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/dns`);
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: jsonOutput, fields: options?.fields });
    }

    s.stop(`${data.records.length} record(s)`);

    if (jsonOutput) {
      jsonOut(data, options?.fields);
      return;
    }

    if (data.records.length === 0) {
      blank();
      console.log(`  ${pc.dim(`No DNS records for ${domain}`)}`);
      blank();
      hintCommand("Auto-configure DNS:", `domani connect ${domain}`);
      blank();
      return;
    }

    const colWidths = [8, 24, 40, 8];
    heading(`DNS ${fmt.domain(domain)}`, colWidths.reduce((a, b) => a + b, 0) + colWidths.length - 1);

    const rows = data.records.map((r: { type: string; name: string; value: string; priority?: number; ttl: number }) => {
      const priority = r.priority ? pc.dim(` pri=${r.priority}`) : "";
      return [
        pc.yellow(r.type),
        r.name,
        pc.cyan(r.value) + priority,
        pc.dim(String(r.ttl)),
      ];
    });

    table(["Type", "Name", "Value", "TTL"], rows, colWidths);
    blank();
    return;
  }

  // ── SET ──────────────────────────────────────────────
  if (action === "set") {
    if (!type || !name || !value) {
      fail("Missing arguments for dns set", {
        hint: "Usage: domani dns <domain> set --type A --name www --value 1.2.3.4",
        code: "validation_error",
        json: jsonOutput,
        fields: options?.fields,
      });
    }

    if (options?.dryRun) {
      return dryRunOut("dns_set", {
        domain,
        record: { type: type.toUpperCase(), name, value, ttl: 3600 },
      }, jsonOutput, options?.fields);
    }

    const s = createSpinner(!jsonOutput);
    s.start(`Setting ${pc.yellow(type.toUpperCase())} record`);

    const getRes = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/dns`);
    const getData = await getRes.json();
    const existing = getRes.ok ? getData.records : [];

    const updated = existing.filter(
      (r: { type: string; name: string }) => !(r.type === type.toUpperCase() && r.name === name)
    );
    updated.push({ type: type.toUpperCase(), name, value, ttl: 3600 });

    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/dns`, {
      method: "PUT",
      body: JSON.stringify({ records: updated }),
    });
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: jsonOutput, fields: options?.fields });
    }

    s.stop(`${S.success} ${pc.yellow(type.toUpperCase())} ${name} ${S.arrow} ${pc.cyan(value)}`);

    if (jsonOutput) {
      jsonOut(data, options?.fields);
    } else {
      blank();
      hintCommand("Check propagation:", `domani status ${domain}`);
      blank();
    }
    return;
  }

  // ── DELETE ───────────────────────────────────────────
  if (action === "delete") {
    if (!type || !name) {
      fail("Missing arguments for dns delete", {
        hint: "Usage: domani dns <domain> delete --type A --name www",
        code: "validation_error",
        json: jsonOutput,
        fields: options?.fields,
      });
    }

    if (options?.dryRun) {
      return dryRunOut("dns_delete", {
        domain,
        record: { type: type.toUpperCase(), name },
      }, jsonOutput, options?.fields);
    }

    const s = createSpinner(!jsonOutput);
    s.start(`Deleting ${pc.yellow(type.toUpperCase())} ${name}`);

    const res = await apiRequest(
      `/api/domains/${encodeURIComponent(domain)}/dns?type=${encodeURIComponent(type.toUpperCase())}&name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    );
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: jsonOutput, fields: options?.fields });
    }

    s.stop(`${S.success} Deleted ${pc.yellow(type.toUpperCase())} ${name}`);

    if (jsonOutput) {
      jsonOut(data, options?.fields);
    } else {
      blank();
      hintCommand("Check propagation:", `domani status ${domain}`);
      blank();
    }
    return;
  }

  // ── SNAPSHOT ────────────────────────────────────────────
  if (action === "snapshot") {
    if (options?.dryRun) {
      return dryRunOut("dns_snapshot", { domain }, jsonOutput, options?.fields);
    }

    const s = createSpinner(!jsonOutput);
    s.start(`Capturing DNS snapshot for ${fmt.domain(domain)}`);

    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/dns/snapshot`, {
      method: "POST",
    });
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: jsonOutput, fields: options?.fields });
    }

    const recordCount = data.records?.length ?? 0;
    s.stop(`${S.success} Captured ${recordCount} record(s)`);

    if (jsonOutput) {
      jsonOut(data, options?.fields);
      return;
    }

    // Save snapshot to file
    const filename = `${domain}.dns.json`;
    const filepath = resolve(process.cwd(), filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2) + "\n");

    heading("DNS Snapshot");
    row("Domain", fmt.domain(data.domain));
    row("Records", String(recordCount));
    row("Subdomains", String(data.subdomains?.length ?? 0));
    row("Sources", (data.sources || []).join(", ") || "none");
    row("Captured", data.capturedAt || data.captured_at || "now");
    row("Saved to", pc.cyan(filename));
    blank();
    hintCommand("Restore from this snapshot:", `domani dns ${domain} restore --file ${filename}`);
    blank();
    return;
  }

  // ── RESTORE ────────────────────────────────────────────
  if (action === "restore") {
    if (options?.dryRun) {
      return dryRunOut("dns_restore", { domain, source: options?.file || "server_backup" }, jsonOutput, options?.fields);
    }

    const s = createSpinner(!jsonOutput);
    let body: string | undefined;

    if (options?.file) {
      // Load snapshot from file - restrict to cwd to prevent path traversal
      const filepath = resolve(process.cwd(), options.file);
      if (!filepath.startsWith(process.cwd())) {
        fail("File path must be within the current directory", {
          hint: `Got: ${options.file}`,
          code: "validation_error",
          json: jsonOutput,
          fields: options?.fields,
        });
      }
      try {
        const raw = readFileSync(filepath, "utf-8");
        const snapshot = JSON.parse(raw);
        body = JSON.stringify({ snapshot });
        s.start(`Restoring DNS for ${fmt.domain(domain)} from ${pc.cyan(options.file)}`);
      } catch (err) {
        fail(`Failed to read snapshot file: ${err instanceof Error ? err.message : "unknown"}`, {
          hint: `Make sure ${options.file} exists and contains valid JSON.`,
          code: "validation_error",
          json: jsonOutput,
          fields: options?.fields,
        });
      }
    } else {
      s.start(`Restoring DNS for ${fmt.domain(domain)} from server backup`);
    }

    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/dns/restore`, {
      method: "POST",
      ...(body ? { body } : {}),
    });
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: jsonOutput, fields: options?.fields });
    }

    s.stop(`${S.success} Restored DNS`);

    if (jsonOutput) {
      jsonOut(data, options?.fields);
      return;
    }

    heading("DNS Restored");
    row("Domain", fmt.domain(data.domain));
    row("Applied", pc.green(String(data.applied ?? 0)));
    row("Skipped", pc.dim(String(data.skipped ?? 0)));
    if (data.errors?.length > 0) {
      row("Errors", pc.red(String(data.errors.length)));
      for (const e of data.errors) {
        console.log(`    ${pc.red("•")} ${e}`);
      }
    }
    blank();
    hintCommand("Verify DNS records:", `domani dns ${domain}`);
    blank();
    return;
  }

  fail(`Unknown action: ${action}`, { hint: "Use 'get', 'set', 'delete', 'snapshot', or 'restore'.", code: "validation_error", json: jsonOutput, fields: options?.fields });
}
