import { apiRequest } from "./api.js";
import { select, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { errorMessage, blank, createSpinner, isTTY, fail } from "./ui.js";

interface Domain {
  domain: string;
  status: string;
}

/**
 * Fetch user's domains and show an interactive picker.
 * In non-TTY mode, fails with a clear error instead of blocking.
 * Exits if user cancels or has no domains.
 */
export async function pickDomain(): Promise<string> {
  // Non-TTY: can't show interactive prompt — fail with actionable error
  if (!isTTY) {
    fail("Missing required argument: domain", {
      hint: "Pass the domain as an argument, e.g. 'domani settings example.com'",
      code: "missing_argument",
      json: true,
    });
  }

  const s = createSpinner(true);
  s.start("Loading your domains");

  const res = await apiRequest("/api/domains");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    errorMessage(data.error, data.hint);
    process.exit(1);
  }

  const domains: Domain[] = data.domains || [];

  if (domains.length === 0) {
    s.stop("No domains");
    blank();
    console.log(`  ${pc.dim("No domains yet.")} Use: ${pc.cyan("domani buy <domain>")}`);
    blank();
    process.exit(0);
  }

  s.stop(`${domains.length} domain(s)`);

  const selected = await select({
    message: "Which domain?",
    options: domains.map((d) => ({
      value: d.domain,
      label: d.domain,
      hint: d.status !== "active" ? d.status : undefined,
    })),
  });

  if (isCancel(selected)) process.exit(0);

  return selected as string;
}
