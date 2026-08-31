import { apiRequest } from "../api.js";
import { confirm as clackConfirm, text, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, skipConfirm, dryRunOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";
import { APP_DOMAIN } from "../brand.js";
import { waitForEligibility } from "../transfer-eligibility.js";
import { renderExitGuidance } from "../guidance.js";

const WATCH_INTERVAL_MS = 60_000;
const WATCH_MAX_ATTEMPTS = 1440; // 24h at one check per minute

export async function transfer(
  domain: string,
  options: { authCode?: string; yes?: boolean; watch?: boolean; dryRun?: boolean; json?: boolean; fields?: string }
): Promise<void> {
  requireValidDomain(domain, options);
  const s = createSpinner(!options.json);

  // Inspect registrar and DNS continuity before asking for an EPP code.
  s.start(`Planning safe adoption for ${fmt.domain(domain)}`);

  const checkRes = await apiRequest(`/api/domains/adoption-plan?domain=${encodeURIComponent(domain)}`);
  let check = await checkRes.json();

  if (!checkRes.ok) {
    s.stop("Check failed");
    fail(check.error, { hint: check.hint, status: checkRes.status, json: options.json, fields: options.fields });
  }

  if (!check.options?.transfer?.eligible) {
    s.stop(`${S.error} Not eligible`);
    const blocked = check.options?.transfer;

    if (options.watch && blocked?.eligible_at) {
      // Date-based wait (ICANN windows): the date is known, so polling adds
      // nothing - register the server watch and get notified when it arrives.
      const watchRes = await apiRequest("/api/domains/transfer-watch", {
        method: "POST",
        body: JSON.stringify({ domain }),
      });
      const watch = await watchRes.json();
      if (!watchRes.ok) {
        fail(watch.error || watch.message, { hint: watch.hint, status: watchRes.status, json: options.json, fields: options.fields });
      }
      if (options.json) {
        jsonOut(watch, options.fields);
        return;
      }
      heading("Transfer Watch Registered");
      row("Domain", fmt.domain(domain));
      row("Eligible from", watch.eligible_at || blocked.eligible_at);
      if (watch.hint) {
        blank();
        console.log(`  ${pc.dim(watch.hint)}`);
      }
      blank();
      return;
    }

    if (options.watch) {
      // Lock-based wait: no determinable date, the unlock propagates within
      // minutes of being flipped at the losing registrar - poll until it does.
      if (!options.json) {
        console.log(`  ${pc.dim(blocked?.reason || "Domain is not eligible for transfer yet.")}`);
        renderExitGuidance(blocked?.guidance);
        blank();
      }
      const w = createSpinner(!options.json);
      w.start(`Watching ${fmt.domain(domain)} until it becomes transferable (every 60s, Ctrl+C to stop)`);
      const outcome = await waitForEligibility<typeof check>({
        fetchPlan: async () => {
          const res = await apiRequest(`/api/domains/adoption-plan?domain=${encodeURIComponent(domain)}`);
          if (!res.ok) return null;
          return res.json();
        },
        isEligible: (plan) => !!plan.options?.transfer?.eligible,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        intervalMs: WATCH_INTERVAL_MS,
        maxAttempts: WATCH_MAX_ATTEMPTS,
      });
      if (outcome.status !== "eligible") {
        w.stop(`${S.error} Watch ended`);
        fail(
          outcome.status === "timeout"
            ? "Domain did not become eligible within 24 hours."
            : "Gave up after repeated failures fetching the adoption plan.",
          {
            hint: "The transfer lock is disabled at the losing registrar; rerun with --watch once you have flipped it.",
            code: outcome.status === "timeout" ? "watch_timeout" : "watch_unreachable",
            json: options.json,
            fields: options.fields,
          },
        );
      }
      check = outcome.plan;
      w.stop(`${S.success} Now eligible for transfer`);
    } else {
      if (!options.json) renderExitGuidance(blocked?.guidance);
      const watchHint = blocked?.eligible_at
        ? `Eligible from ${blocked.eligible_at}. Rerun with --watch to register a server watch (email + webhook when the date arrives).`
        : "Fix the blocker above, then rerun - or rerun with --watch to poll until the domain becomes eligible and continue automatically.";
      const guidanceHint = options.json && blocked?.guidance
        ? ` The registrar exit playbook is in the adoption plan (options.transfer.guidance, \`domani adopt ${domain} --json\`).`
        : "";
      fail(blocked?.reason || "Domain is not eligible for transfer.", {
        hint: [watchHint + guidanceHint, ...(check.warnings?.length ? [check.warnings.join(" ")] : [])].join(" "),
        code: "not_eligible",
        json: options.json,
        fields: options.fields,
      });
    }
  } else {
    s.stop(`${S.success} Eligible for transfer`);
  }

  if (options.dryRun) {
    return dryRunOut("transfer", {
      domain,
      eligible: true,
      price: check.options.transfer.price,
      currency: check.options.transfer.currency || "USD",
      includes_renewal: true,
      preserves_nameservers: true,
      migrates_dns: false,
      nameservers: check.current.nameservers,
      dns_provider: check.current.dns_provider,
      dnssec_enabled: check.current.dnssec_enabled,
    }, options.json, options.fields);
  }

  if (!skipConfirm(options)) {
    heading("Transfer Safety Plan");
    row("Registrar", check.current.registrar || "Unknown");
    row("DNS provider", check.current.dns_provider);
    row("Nameservers", `${check.current.nameservers.length} preserved`);
    row("DNSSEC", check.current.dnssec_enabled ? pc.yellow("Enabled, DS will be verified") : "Not enabled");
    row("DNS migration", "Not requested");
    blank();
    const price = check.options.transfer.price != null ? ` for ${fmt.price(check.options.transfer.price.toFixed(2))}` : "";
    const ok = await clackConfirm({
      message: `Transfer ${pc.bold(domain)} to ${APP_DOMAIN}${price}? Nameservers stay unchanged and 1 year is included.`,
    });
    if (!ok || typeof ok === "symbol") {
      console.log(`  ${pc.dim("Cancelled.")}`);
      return;
    }
  }

  if (!options.authCode) {
    if (options.json || !process.stdout.isTTY) {
      fail("--auth-code is required", {
        hint: "The safety plan passed. Get the EPP/auth code from the current registrar and retry.",
        code: "validation_error",
        json: options.json,
        fields: options.fields,
      });
    }
    // The auth code lives at the losing registrar; say where when we know.
    if (check.options?.transfer?.guidance) {
      console.log(`  ${pc.dim("Where to get it:")} ${check.options.transfer.guidance.auth_code}`);
    }
    const code = await text({
      message: "Enter the EPP/auth code from your current registrar:",
      validate: (value) => (!value || value.trim().length === 0 ? "Auth code is required" : undefined),
    });
    if (isCancel(code)) process.exit(0);
    options.authCode = code as string;
  }

  s.start(`Initiating transfer for ${fmt.domain(domain)}`);

  const res = await apiRequest("/api/domains/transfer", {
    method: "POST",
    body: JSON.stringify({ domain, auth_code: options.authCode }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Transfer failed");
    fail(data.error || data.message, { hint: data.hint, fixUrl: data.setup_url || data.payment_options?.card?.setup_url, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Transfer initiated`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Transfer Initiated");
  row("Domain", fmt.domain(data.domain));
  row("Status", pc.yellow(data.status || "pending"));
  if (data.price) row("Price", fmt.price(data.price) + pc.dim(` ${data.currency || "USD"}`));
  if (data.payment_method) row("Payment", data.payment_method);
  if (data.expires) row("Expires", new Date(data.expires).toLocaleDateString());
  if (data.hint) {
    blank();
    console.log(`  ${pc.dim(data.hint)}`);
  }
  blank();
  hintCommand("Check transfer progress:", `domani status ${data.domain}`);
  blank();
}
