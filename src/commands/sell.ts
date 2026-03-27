import { apiRequest } from "../api.js";
import pc from "picocolors";
import { S, fmt, heading, row, blank, hintCommand, createSpinner, jsonOut, fail } from "../ui.js";
import { requireValidDomain } from "../validate.js";

export async function sell(
  domain: string,
  options: {
    price?: string;
    verify?: boolean;
    transferCode?: string;
    cancel?: boolean;
    status?: boolean;
    description?: string;
    json?: boolean;
    fields?: string;
  }
): Promise<void> {
  if (!domain) {
    fail("Domain is required", {
      hint: "Usage: domani sell <domain> --price <amount>\n       domani sell <domain> --verify\n       domani sell <domain> --status\n       domani sell <domain> --cancel",
      code: "validation_error",
      json: options.json,
      fields: options.fields,
    });
  }

  requireValidDomain(domain, options);

  if (options.status) return sellStatus(domain, options);
  if (options.verify) return sellVerify(domain, options);
  if (options.cancel) return sellCancel(domain, options);
  if (options.transferCode) return sellTransferCode(domain, options.transferCode, options);
  if (options.price) return sellList(domain, options);

  fail("No action specified", {
    hint: "Usage: domani sell <domain> --price <amount>\n       domani sell <domain> --verify\n       domani sell <domain> --status\n       domani sell <domain> --cancel\n       domani sell <domain> --transfer-code <code>",
    code: "validation_error",
    json: options.json,
    fields: options.fields,
  });
}

// -- List domain for sale ────────────────────────────

async function sellList(
  domain: string,
  options: { price?: string; description?: string; json?: boolean; fields?: string }
): Promise<void> {
  const price = parseFloat(options.price!);
  if (isNaN(price) || price <= 0) {
    fail("Invalid price", {
      hint: "Price must be a positive number, e.g. --price 5000",
      code: "validation_error",
      json: options.json,
      fields: options.fields,
    });
  }

  const s = createSpinner(!options.json);
  s.start(`Listing ${fmt.domain(domain)} for sale`);

  const body: Record<string, unknown> = { domain, price };
  if (options.description) body.description = options.description;

  const res = await apiRequest("/api/domains/sell", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Listing failed");
    fail(data.error || data.message, {
      hint: data.hint,
      status: res.status,
      json: options.json,
      fields: options.fields,
    });
  }

  if (options.json) {
    s.stop("");
    jsonOut(data, options.fields);
    return;
  }

  const listingStatus = data.listing?.status ?? "pending_verification";

  if (listingStatus === "active") {
    // Internal domain — auto-verified
    s.stop(`${S.success} Listed for sale`);
    heading("Sell Domain");
    row("Domain", fmt.domain(data.listing?.domain || domain));
    row("Price", fmt.price(price));
    row("Status", pc.green("active"));
    blank();
    console.log(`  ${pc.dim("Your listing is live on the marketplace.")}`);
    blank();
  } else {
    // External domain — needs TXT verification
    s.stop(`${S.success} Verification record ready`);
    heading("Sell Domain");
    row("Domain", fmt.domain(data.listing?.domain || domain));
    row("Price", fmt.price(price));
    row("Status", pc.yellow("pending verification"));
    blank();
    console.log(`  Add this TXT record at your DNS provider:`);
    blank();
    console.log(`    ${pc.dim("Type:")}  ${pc.bold("TXT")}`);
    console.log(`    ${pc.dim("Name:")}  ${pc.bold(data.txt_record?.name || "@")}`);
    console.log(`    ${pc.dim("Value:")} ${pc.bold(data.txt_record?.value || `domani-verify=${data.token}`)}`);
    blank();
    console.log(`  ${pc.dim("DNS propagation may take a few minutes to 48 hours.")}`);
    blank();
    hintCommand("Once the record is set, verify:", `domani sell ${domain} --verify`);
    blank();
  }
}

// -- Verify ownership ────────────────────────────────

async function sellVerify(
  domain: string,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  const s = createSpinner(!options.json);
  s.start(`Verifying ownership of ${fmt.domain(domain)}`);

  const res = await apiRequest("/api/domains/sell/verify", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Verification failed");
    fail(data.error || data.message, {
      hint: data.hint,
      status: res.status,
      json: options.json,
      fields: options.fields,
    });
  }

  if (options.json) {
    s.stop("");
    jsonOut(data, options.fields);
    return;
  }

  s.stop(`${S.success} ${fmt.domain(domain)} is now listed for sale!`);

  heading("Domain Listed");
  row("Domain", fmt.domain(data.domain || domain));
  row("Status", pc.green(data.status || "active"));
  if (data.price) row("Price", fmt.price(data.price));
  blank();
  hintCommand("Check listing status:", `domani sell ${domain} --status`);
  hintCommand("View your deals:", "domani deals");
  blank();
}

// -- Check listing status ────────────────────────────

async function sellStatus(
  domain: string,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  const s = createSpinner(!options.json);
  s.start(`Checking listing status for ${fmt.domain(domain)}`);

  const res = await apiRequest(`/api/domains/sell/status?domain=${encodeURIComponent(domain)}`);
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, {
      hint: data.hint,
      status: res.status,
      json: options.json,
      fields: options.fields,
    });
  }

  s.stop(`${S.success} Listing status loaded`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  const listing = data.listing;
  heading("Listing Status");
  row("Domain", fmt.domain(data.domain || domain));
  if (listing) {
    const st = listing.status;
    row("Status", st === "active" ? pc.green(st) : pc.yellow(st || "unknown"));
    if (listing.price) row("Price", fmt.price(listing.price));
    if (listing.description) row("Description", listing.description);
    if (listing.created_at) row("Listed", pc.dim(new Date(listing.created_at).toLocaleDateString()));
  } else {
    row("Status", pc.dim("No listing found"));
  }
  if (data.deal) {
    row("Deal", `${data.deal.status} ($${data.deal.price})`);
  }
  blank();
}

// -- Cancel listing ──────────────────────────────────

async function sellCancel(
  domain: string,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  const s = createSpinner(!options.json);
  s.start(`Removing ${fmt.domain(domain)} from sale`);

  const res = await apiRequest(`/api/domains/sell?domain=${encodeURIComponent(domain)}`, {
    method: "DELETE",
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, {
      hint: data.hint,
      status: res.status,
      json: options.json,
      fields: options.fields,
    });
  }

  if (options.json) {
    s.stop("");
    jsonOut(data, options.fields);
    return;
  }

  s.stop(`${S.success} ${fmt.domain(domain)} removed from sale`);
  blank();
}

// -- Provide transfer code to buyer's deal ───────────

async function sellTransferCode(
  domain: string,
  code: string,
  options: { json?: boolean; fields?: string }
): Promise<void> {
  const s = createSpinner(!options.json);
  s.start(`Looking up active deal for ${fmt.domain(domain)}`);

  // Find the active deal where this user is the seller
  const listRes = await apiRequest(
    `/api/deals?role=seller&domain=${encodeURIComponent(domain)}&status=active`
  );
  const listData = await listRes.json();

  if (!listRes.ok) {
    s.stop("Failed");
    fail(listData.error || listData.message, {
      hint: listData.hint,
      status: listRes.status,
      json: options.json,
      fields: options.fields,
    });
  }

  const allDeals = listData.deals || listData.data || [];
  const deals = allDeals.filter((d: { domain: string }) => d.domain.toLowerCase() === domain.toLowerCase());
  if (deals.length === 0) {
    s.stop("No active deal found");
    fail(`No active deal found for ${domain}`, {
      hint: "Make sure you have an active sale for this domain.\nRun 'domani deals --role seller' to see your deals.",
      code: "not_found",
      json: options.json,
      fields: options.fields,
    });
  }

  const dealId = deals[0].id;
  s.message(`Submitting transfer code for deal ${pc.dim(dealId)}`);

  const patchRes = await apiRequest(`/api/deals/${encodeURIComponent(dealId)}`, {
    method: "PATCH",
    body: JSON.stringify({ auth_code: code }),
  });
  const patchData = await patchRes.json();

  if (!patchRes.ok) {
    s.stop("Failed");
    fail(patchData.error || patchData.message, {
      hint: patchData.hint,
      status: patchRes.status,
      json: options.json,
      fields: options.fields,
    });
  }

  if (options.json) {
    s.stop("");
    jsonOut(patchData, options.fields);
    return;
  }

  s.stop(`${S.success} Transfer code submitted for ${fmt.domain(domain)}`);

  heading("Transfer Code Submitted");
  row("Domain", fmt.domain(domain));
  row("Deal", pc.dim(dealId));
  row("Status", pc.green(patchData.status || "code_submitted"));
  blank();
  hintCommand("Track the deal:", `domani deals ${dealId}`);
  blank();
}
