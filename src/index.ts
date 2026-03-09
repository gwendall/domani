import { Command } from "commander";
import pc from "picocolors";
import { setApiUrlOverride, checkVersion, CLI_VERSION } from "./config.js";
import { APP_DOMAIN } from "./brand.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { me } from "./commands/me.js";
import { search } from "./commands/search.js";
import { buy } from "./commands/buy.js";
import { list } from "./commands/list.js";
import { dns } from "./commands/dns.js";
import { tlds } from "./commands/tlds.js";
import { whois } from "./commands/whois.js";
import { suggest } from "./commands/suggest.js";
import { connect } from "./commands/connect.js";
import { status } from "./commands/status.js";
import { transfer } from "./commands/transfer.js";
import { renew } from "./commands/renew.js";
import { importDomain } from "./commands/import.js";
import { email } from "./commands/email.js";
import { token } from "./commands/token.js";
import { tokens } from "./commands/tokens.js";
import { settings } from "./commands/settings.js";
import { authCode } from "./commands/auth-code.js";
import { transferAway } from "./commands/transfer-away.js";
import { contact } from "./commands/contact.js";
import { parking } from "./commands/parking.js";
import { analytics } from "./commands/analytics.js";
import { webhooks } from "./commands/webhooks.js";
import { invoices } from "./commands/invoices.js";
import { billing } from "./commands/billing.js";
import { nameservers } from "./commands/nameservers.js";
import { update } from "./commands/update.js";
import { uninstall } from "./commands/uninstall.js";
import { schema } from "./commands/schema.js";
const program = new Command();

program
  .name("domani")
  .description(`Domain names for developers and AI agents - ${APP_DOMAIN}`)
  .version(CLI_VERSION)
  .option("--api-url <url>", "Override API base URL")
  .hook("preAction", (thisCommand, actionCommand) => {
    const opts = thisCommand.opts();
    if (opts.apiUrl) setApiUrlOverride(opts.apiUrl);

    // TTY auto-detect: when stdout is piped (not a terminal),
    // auto-enable JSON output for commands that support it.
    // This lets agents run `domani list | jq` without --json.
    if (!process.stdout.isTTY) {
      const hasJsonOpt = actionCommand.options.some(
        (o: { long?: string }) => o.long === "--json"
      );
      if (hasJsonOpt) {
        actionCommand.setOptionValue("json", true);
      }
    }
  });

// ── Auth ──────────────────────────────────────────────

program
  .command("login")
  .description(`Log in to ${APP_DOMAIN} (opens browser)`)
  .option("--json", "Output as JSON (returns auth_url for non-interactive approval)")
  .action(login);

program
  .command("logout")
  .description("Clear saved credentials")
  .option("--json", "Output as JSON")
  .action(logout);

program
  .command("me")
  .description("Show account info")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(me);

program
  .command("invoices")
  .description("List payment invoices")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .option("--limit <n>", "Max invoices to show (default 20)")
  .action(invoices);

program
  .command("billing")
  .description("Add or update payment method (opens browser)")
  .option("--json", "Output as JSON (returns checkout URL)")
  .action(billing);

program
  .command("token")
  .description("Print your API key")
  .option("--json", "Output as JSON")
  .action(token);

program
  .command("tokens [action]")
  .description("Manage API tokens (list/create/revoke)")
  .option("--name <name>", "Token name (for create)")
  .option("--scopes <scopes>", "Comma-separated permission scopes (for create)")
  .option("--expires-in <seconds>", "Token lifetime in seconds (for create, min 3600)")
  .option("--token-id <id>", "Token ID (for revoke)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(tokens);

// ── Discovery ─────────────────────────────────────────

program
  .command("search [domain] [tlds...]")
  .description("Check availability - domani search myapp .io .fm .xyz")
  .option("--tlds <tlds>", "Comma-separated TLDs (e.g. com,io,dev)")
  .option("--max-price <price>", "Maximum price filter")
  .option("--all", "Show taken domains too")
  .option("--expand", "Check 30+ TLDs including creative/exotic extensions")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(search);

program
  .command("tlds")
  .description("List all TLDs with pricing")
  .option("--max-price <price>", "Maximum registration price")
  .option("--min-price <price>", "Minimum registration price")
  .option("--sort <field>", "Sort by: price, tld, renewal (default: tld)")
  .option("--search <term>", "Filter TLDs by name")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(tlds);

program
  .command("whois <domain>")
  .description("WHOIS/RDAP lookup for any domain")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(whois);

program
  .command("suggest [prompt]")
  .description("AI-powered domain name suggestions")
  .option("--count <n>", "Number of suggestions (1-20, default 10)")
  .option("--tlds <tlds>", "Preferred TLDs, comma-separated (e.g. com,dev,ai)")
  .option("--style <style>", "Name style: single, creative, short, brandable, keyword")
  .option("--lang <lang>", "Language inspiration: japanese, spanish, french, italian, latin, nordic, arabic, sanskrit")
  .option("--timeout <seconds>", "Request timeout in seconds (default: 60)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(suggest);

// ── Registration ──────────────────────────────────────

program
  .command("buy [domains...]")
  .description("Purchase one or more domains")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(buy);

program
  .command("transfer <domain>")
  .description("Transfer a domain from another registrar")
  .option("--auth-code <code>", "EPP/auth code from current registrar")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(transfer);

program
  .command("renew [domain]")
  .description("Renew a domain")
  .option("--years <n>", "Number of years (1-10, default: 1)")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(renew);

program
  .command("import <domain>")
  .description("Import a domain you own at another registrar")
  .option("--verify", "Verify DNS ownership and complete import")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(importDomain);

// ── Management ────────────────────────────────────────

program
  .command("list")
  .description("List your domains")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(list);

program
  .command("status [domain]")
  .description("Check domain health (DNS, SSL, email, expiry)")
  .option("--timeout <seconds>", "Request timeout in seconds (default: 30)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(status);

program
  .command("connect [domain] [target]")
  .description("Connect domain to a hosting/email provider")
  .option("--provider <name>", "Provider name (e.g. vercel, google-workspace)")
  .option("--method <name>", "Connection method (e.g. cname-only)")
  .option("--list", "List available providers")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(connect);

program
  .command("email [action] [arg2]")
  .description("Manage email: list, inbox, create, delete, send, forward, webhook, setup, status, check, connect")
  .option("--domain <domain>", "Domain name")
  .option("--slug <slug>", "Mailbox slug (local part before @)")
  .option("--from <email>", "Sender address user@domain (alternative to --domain + --slug)")
  .option("--to <email>", "Recipient email address (for send)")
  .option("--cc <emails>", "CC recipients, comma-separated (for send)")
  .option("--bcc <emails>", "BCC recipients, comma-separated (for send)")
  .option("--subject <s>", "Email subject (for send)")
  .option("--text <t>", "Email body text (for send)")
  .option("--body <t>", "Email body text (alias for --text)")
  .option("--in-reply-to <message-id>", "Message-ID of email being replied to (for threading)")
  .option("--references <message-ids>", "Space-separated Message-ID chain (for threading)")
  .option("--url <url>", "Webhook URL (for webhook)")
  .option("--forward-to <email>", "Email address to forward inbound emails to (for forward)")
  .option("--direction <dir>", "Filter messages: in or out")
  .option("--limit <n>", "Limit results")
  .option("--check", "Verify email DNS health (MX, SPF, DKIM, DMARC)")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(email);

program
  .command("dns [domain] [action] [type] [name] [value]")
  .description("Manage DNS records (get/set/delete/snapshot/restore)")
  .option("--type <type>", "Record type: A, AAAA, CNAME, MX, TXT, NS, SRV")
  .option("--name <name>", "Record name (e.g. www, @, _dmarc)")
  .option("--value <value>", "Record value")
  .option("--file <path>", "Snapshot file path (for restore)")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(dns);

program
  .command("nameservers [domain] [ns...]")
  .description("Get or set nameservers (--reset for defaults)")
  .option("--set <ns>", "Comma-separated nameservers to set")
  .option("--reset", "Reset to registrar default nameservers")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(nameservers);

program
  .command("settings [domain]")
  .description("View or update domain settings (auto-renew, WHOIS privacy, security lock)")
  .option("--auto-renew <on|off>", "Enable or disable auto-renew")
  .option("--whois-privacy <on|off>", "Enable or disable WHOIS privacy")
  .option("--security-lock <on|off>", "Lock or unlock domain transfers")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(settings);

program
  .command("auth-code [domain]")
  .description("Get EPP auth code to transfer domain to another registrar")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(authCode);

program
  .command("transfer-away [domain]")
  .description("Check status of an outbound domain transfer")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(transferAway);

program
  .command("contact [action]")
  .description("View or set WHOIS contact info (required for purchases)")
  .option("--first-name <name>", "First name (for set)")
  .option("--last-name <name>", "Last name (for set)")
  .option("--org-name <name>", "Organization name (for set, optional)")
  .option("--address1 <addr>", "Address line 1 (for set)")
  .option("--address2 <addr>", "Address line 2 (for set, optional)")
  .option("--city <city>", "City (for set)")
  .option("--state <state>", "State/Province (for set)")
  .option("--postal-code <code>", "Postal/ZIP code (for set)")
  .option("--country <code>", "Country code ISO 3166-1 alpha-2 (for set)")
  .option("--phone <phone>", "Phone +CC.NUMBER (for set)")
  .option("--email <email>", "Contact email (for set)")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(contact);

program
  .command("parking [domain] [action] [value]")
  .description("Manage parking page (enable/disable/price)")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(parking);

program
  .command("analytics [domain]")
  .description("View parking analytics (views, inquiries, conversion)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(analytics);

program
  .command("webhooks [action]")
  .alias("webhook")
  .description("Manage webhook endpoints (list/create/update/delete/deliveries/events)")
  .option("--url <url>", "Webhook HTTPS URL")
  .option("--events <events>", "Comma-separated event types")
  .option("--webhook-id <id>", "Webhook ID (for update/delete/deliveries)")
  .option("--active <on|off>", "Enable or disable webhook")
  .option("--limit <n>", "Limit deliveries returned")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(webhooks);

// ── Introspection ──────────────────────────────────────

program
  .command("schema [command]")
  .description("Show command schemas for AI agent integration")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(schema);

// ── Utility ──────────────────────────────────────────

program
  .command("update")
  .description("Update domani CLI to the latest version")
  .option("--json", "Output as JSON (check version without updating)")
  .action(update);

program
  .command("uninstall")
  .description("Remove domani CLI and config from this machine")
  .action(uninstall);

// ── Run ──────────────────────────────────────────────

(async () => {
  const versionCheck = checkVersion();

  await program.parseAsync();

  // Show update notice after command completes
  const result = await versionCheck;
  if (result?.forced) {
    console.error(`\n  ${pc.red("!")} CLI v${CLI_VERSION} is no longer supported. Run ${pc.bold("domani update")} to upgrade to v${result.update}\n`);
    process.exit(1);
  } else if (result?.update) {
    console.error(`\n  ${pc.yellow("!")} Update available: ${pc.dim(CLI_VERSION)} ${pc.dim("→")} ${pc.green(result.update)}  Run ${pc.bold("domani update")}\n`);
  }
})();
