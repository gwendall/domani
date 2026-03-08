import { apiRequest } from "../api.js";
import { text, isCancel } from "@clack/prompts";
import pc from "picocolors";
import { S, heading, row, blank, createSpinner, jsonOut, dryRunOut, fail, isTTY } from "../ui.js";

export async function contact(
  action: string | undefined,
  options: {
    dryRun?: boolean; json?: boolean; fields?: string;
    firstName?: string; lastName?: string; orgName?: string;
    address1?: string; address2?: string; city?: string;
    state?: string; postalCode?: string; country?: string;
    phone?: string; email?: string;
  },
): Promise<void> {
  if (action === "set") {
    return contactSet(options);
  }
  return contactView(options);
}

async function contactView(options: { json?: boolean; fields?: string }): Promise<void> {
  const s = createSpinner(!options.json);
  s.start("Loading contact info");

  const res = await apiRequest("/api/me/contact");
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Contact info`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Contact Info");

  if (!data.has_contact) {
    console.log(`  ${S.warning} ${pc.yellow("No contact info set.")} Run ${pc.bold("domani contact set")} to add.`);
    blank();
    console.log(`  ${pc.dim("Contact info is required before purchasing domains.")}`);
    blank();
    return;
  }

  const c = data.contact;
  row("Name", `${c.first_name} ${c.last_name}`);
  if (c.org_name) row("Organization", c.org_name);
  row("Address", c.address1);
  if (c.address2) row("", c.address2);
  row("", `${c.city}, ${c.state} ${c.postal_code}`);
  row("Country", c.country);
  row("Phone", c.phone);
  row("Email", c.email);
  blank();
}

async function contactSet(options: {
  dryRun?: boolean; json?: boolean; fields?: string;
  firstName?: string; lastName?: string; orgName?: string;
  address1?: string; address2?: string; city?: string;
  state?: string; postalCode?: string; country?: string;
  phone?: string; email?: string;
}): Promise<void> {
  const fields: Record<string, string> = {};

  // Non-TTY / agent mode: accept flags directly
  const hasFlags = options.firstName || options.lastName || options.address1;
  if (!isTTY && !hasFlags) {
    fail("Missing required flags for contact set", {
      hint: "Usage: domani contact set --first-name John --last-name Doe --address1 '123 Main St' --city SF --state CA --postal-code 94105 --country US --phone +1.5551234567 --email john@example.com",
      code: "missing_argument",
      json: options.json,
    });
  }

  if (hasFlags) {
    // Flag-based mode (agents)
    const required = ["firstName", "lastName", "address1", "city", "state", "postalCode", "country", "phone", "email"] as const;
    const flagMap: Record<string, string> = {
      firstName: "first_name", lastName: "last_name", orgName: "org_name",
      address1: "address1", address2: "address2", city: "city",
      state: "state", postalCode: "postal_code", country: "country",
      phone: "phone", email: "email",
    };
    const missing = required.filter((k) => !options[k]);
    if (missing.length > 0) {
      fail(`Missing required flags: ${missing.map(k => `--${k.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`).join(", ")}`, {
        code: "missing_argument",
        json: options.json,
      });
    }
    for (const [optKey, apiKey] of Object.entries(flagMap)) {
      const val = options[optKey as keyof typeof options] as string | undefined;
      if (val) fields[apiKey] = val;
    }
  } else {
    // Interactive mode (TTY)
    const existing = await apiRequest("/api/me/contact");
    const existingData = existing.ok ? await existing.json() : null;
    const c = existingData?.contact;

    const prompts: { key: string; message: string; placeholder: string; required: boolean }[] = [
      { key: "first_name", message: "First name", placeholder: "John", required: true },
      { key: "last_name", message: "Last name", placeholder: "Doe", required: true },
      { key: "org_name", message: "Organization (optional, press Enter to skip)", placeholder: "Acme Inc.", required: false },
      { key: "address1", message: "Address line 1", placeholder: "123 Main St", required: true },
      { key: "address2", message: "Address line 2 (optional)", placeholder: "Suite 100", required: false },
      { key: "city", message: "City", placeholder: "San Francisco", required: true },
      { key: "state", message: "State / Province", placeholder: "CA", required: true },
      { key: "postal_code", message: "Postal / ZIP code", placeholder: "94105", required: true },
      { key: "country", message: "Country code (ISO 3166-1 alpha-2)", placeholder: "US", required: true },
      { key: "phone", message: "Phone (+CC.NUMBER)", placeholder: "+1.5551234567", required: true },
      { key: "email", message: "Contact email", placeholder: "john@example.com", required: true },
    ];

    for (const p of prompts) {
      const defaultValue = c?.[p.key] || "";
      const value = await text({
        message: p.message,
        placeholder: p.placeholder,
        defaultValue,
        validate: p.required
          ? (v: string | undefined) => (!v?.trim() ? `${p.message} is required` : undefined)
          : undefined,
      });

      if (isCancel(value)) process.exit(0);

      const str = (value as string).trim();
      if (str) fields[p.key] = str;
    }
  }

  if (options.dryRun) {
    return dryRunOut("contact_set", fields, options.json, options.fields);
  }

  const s = createSpinner(!options.json);
  s.start("Saving contact info");

  const res = await apiRequest("/api/me/contact", {
    method: "PUT",
    body: JSON.stringify(fields),
  });
  const data = await res.json();

  if (!res.ok) {
    s.stop("Failed");
    fail(data.error || data.message, { hint: data.hint, status: res.status, json: options.json, fields: options.fields });
  }

  s.stop(`${S.success} Contact info saved`);

  if (options.json) {
    jsonOut(data, options.fields);
    return;
  }

  heading("Contact Saved");
  const saved = data.contact;
  row("Name", `${saved.first_name} ${saved.last_name}`);
  if (saved.org_name) row("Organization", saved.org_name);
  row("Address", saved.address1);
  if (saved.address2) row("", saved.address2);
  row("", `${saved.city}, ${saved.state} ${saved.postal_code}`);
  row("Country", saved.country);
  row("Phone", saved.phone);
  row("Email", saved.email);
  blank();
}
