import { apiRequest } from "../api.js";
import pc from "picocolors";
import { select, text, isCancel } from "@clack/prompts";
import { S, fmt, heading, row, blank, hint, padCell, createSpinner, sleep, jsonOut, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { pickDomain } from "../prompt.js";

type Provider = {
  name: string;
  category: string;
  requires_target?: boolean;
  notes?: { setup?: string; after_connect?: string } | null;
  methods: { name: string; default: boolean }[];
};

export async function connect(
  domain: string | undefined,
  targetOrProvider: string | undefined,
  options: { provider?: string; method?: string; dryRun?: boolean; json?: boolean; fields?: string; list?: boolean }
): Promise<void> {
  if (!domain) domain = await pickDomain();
  requireValidDomain(domain, options);

  // Resolve second positional arg: if it looks like a provider name (no dots), treat it as --provider
  let target: string | undefined;
  if (targetOrProvider && !options.provider) {
    if (targetOrProvider.includes(".")) {
      target = targetOrProvider; // e.g. "my-app.vercel.app"
    } else {
      options.provider = targetOrProvider; // e.g. "vercel", "google-workspace"
    }
  } else {
    target = targetOrProvider;
  }

  // Dry-run without provider: show what connect *would* need
  if (!target && !options.provider && !options.list && options.dryRun) {
    return dryRunOut("connect", { domain, note: "No provider specified. Pass --provider <name> to connect." }, options.json, options.fields);
  }

  // Interactive picker when no target/provider given
  if (!target && !options.provider && !options.list) {
    const s = createSpinner(!options.json);
    s.start(`Loading providers for ${fmt.domain(domain)}`);

    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/connect`);
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }

    s.stop("Providers loaded");

    if (options.json) {
      jsonOut(data, options.fields);
      return;
    }

    // Build select options grouped by category
    const selectOptions: { value: string; label: string; hint?: string }[] = [];
    for (const category of ["hosting", "email"] as const) {
      const providers: Provider[] = data.providers?.[category] || [];
      for (const p of providers) {
        selectOptions.push({
          value: `${category}:${p.name}`,
          label: p.name,
          hint: category,
        });
      }
    }

    if (selectOptions.length === 0) {
      fail("No providers available", { code: "not_found", json: options.json, fields: options.fields });
    }

    const selected = await select({
      message: "Choose a provider",
      options: selectOptions,
    });

    if (isCancel(selected)) process.exit(0);

    const [category, providerName] = (selected as string).split(":");
    const allProviders: Provider[] = data.providers?.[category] || [];
    const provider = allProviders.find((p) => p.name === providerName);

    // If provider has multiple methods, ask which one
    let method: string | undefined;
    if (provider && provider.methods.length > 1) {
      const methodChoice = await select({
        message: "Choose a method",
        options: provider.methods.map((m) => ({
          value: m.name,
          label: m.name,
          hint: m.default ? "default" : undefined,
        })),
      });
      if (isCancel(methodChoice)) process.exit(0);
      method = methodChoice as string;
    }

    // For hosting, ask for target only if provider requires it
    let hostingTarget: string | undefined;
    if (category === "hosting" && provider?.requires_target) {
      if (provider.notes?.setup) {
        hint(provider.notes.setup);
      }
      const targetInput = await text({
        message: "Target hostname or IP",
      });
      if (isCancel(targetInput)) process.exit(0);
      hostingTarget = (targetInput as string).trim();
    }

    return doConnect(domain, {
      target: hostingTarget,
      provider: providerName,
      method,
      dryRun: options.dryRun,
      json: false,
    });
  }

  // --list flag: just display providers
  if (options.list) {
    const s = createSpinner(!options.json);
    s.start(`Loading providers for ${fmt.domain(domain)}`);

    const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/connect`);
    const data = await res.json();

    if (!res.ok) {
      s.stop("Failed");
      fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
    }

    s.stop("Providers loaded");

    if (options.json) {
      jsonOut(data, options.fields);
      return;
    }

    heading(`Providers for ${fmt.domain(data.domain)}`);

    for (const category of ["hosting", "email"] as const) {
      const providers = data.providers?.[category];
      if (!providers?.length) continue;

      blank();
      console.log(`  ${pc.bold(category.toUpperCase())}`);
      for (const p of providers) {
        const methods = p.methods
          .map((m: { name: string; default: boolean }) =>
            m.default ? pc.green(`${m.name} (default)`) : pc.dim(m.name)
          )
          .join(pc.dim(", "));
        console.log(`    ${pc.cyan(p.name.padEnd(20))} ${methods}`);
      }
    }

    blank();
    return;
  }

  // Direct connect (target or --provider given)
  return doConnect(domain, options);
}

async function doConnect(
  domain: string,
  options: { target?: string; provider?: string; method?: string; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  const body: Record<string, string> = {};
  if (options.target) body.target = options.target;
  if (options.provider) body.provider = options.provider;
  if (options.method) body.method = options.method;

  if (options.dryRun) {
    return dryRunOut("connect", { domain, ...body }, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start(`Connecting ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/${encodeURIComponent(domain)}/connect`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Connection failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  const isManual = data.status === "manual_setup_required";
  s.stop(isManual
    ? `${S.success} DNS instructions for ${pc.cyan(data.provider)}`
    : `${S.success} Connected to ${pc.cyan(data.provider)}`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading(isManual
    ? `Add these records at your registrar for ${fmt.domain(data.domain)}`
    : `Connected ${fmt.domain(data.domain)}`);
  row("Provider", pc.cyan(data.provider));
  row("Method", data.method);

  if (data.records?.length) {
    const colWidths = [8, 22, 40];
    blank();
    console.log(`  ${pc.bold("DNS Records")}`);

    const headerLine = ["Type", "Name", "Value"].map((h, i) => pc.dim(h.padEnd(colWidths[i]))).join(" ");
    const divider = colWidths.map((w) => pc.dim("─".repeat(w))).join(" ");
    console.log(`  ${headerLine}`);
    console.log(`  ${divider}`);

    for (const entry of data.records) {
      const r = entry.record;
      const isNew = entry.status !== "already_set";
      if (process.stdout.isTTY && isNew) await sleep(50);
      const cells = [
        pc.yellow(r.type),
        r.name,
        pc.cyan(r.value) + (r.priority ? pc.dim(` pri=${r.priority}`) : ""),
      ];
      const line = cells.map((cell: string, i: number) => padCell(cell, colWidths[i])).join(" ");
      const icon = entry.status === "already_set" ? pc.dim("✓") : entry.status === "updated" ? pc.yellow("↺") : entry.status === "pending" ? pc.yellow("→") : S.success;
      const suffix = entry.status === "already_set" ? pc.dim(" already set") : entry.status === "updated" ? pc.dim(" updated") : entry.status === "pending" ? pc.dim(" add this") : "";
      console.log(`  ${icon} ${line}${suffix}`);
    }
  }

  blank();
  if (data.next_steps?.length) {
    console.log(`  ${pc.bold("Next steps")}`);
    data.next_steps.forEach((step: string, i: number) => {
      console.log(`  ${pc.dim(`${i + 1}.`)} ${step}`);
    });
  } else if (data.hint) {
    console.log(`  ${pc.dim(data.hint)}`);
  }
  if (data.docs) console.log(`  ${pc.dim("Docs:")} ${fmt.url(data.docs)}`);
  blank();
}
