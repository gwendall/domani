import { Command } from "commander";

// Clack spinners add keypress listeners for Ctrl+C handling.
// Increase the limit to avoid false MaxListenersExceeded warnings during polling.
process.stdin.setMaxListeners(50);
import pc from "picocolors";
import { setApiUrlOverride, checkVersion, CLI_VERSION } from "./config.js";
import { ensureAuth } from "./auth.js";
import { fail } from "./ui.js";
import { APP_DOMAIN } from "./brand.js";
import { login } from "./commands/login.js";
import { logout } from "./commands/logout.js";
import { me } from "./commands/me.js";
import { search } from "./commands/search.js";
import { buy } from "./commands/buy.js";
import { provision } from "./commands/provision.js";
import { list } from "./commands/list.js";
import { dns } from "./commands/dns.js";
import { tlds } from "./commands/tlds.js";
import { whois } from "./commands/whois.js";
import { suggest } from "./commands/suggest.js";
import { connect } from "./commands/connect.js";
import { status } from "./commands/status.js";
import { transfer } from "./commands/transfer.js";
import { adopt } from "./commands/adopt.js";
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
import { sell } from "./commands/sell.js";
import { deals } from "./commands/deals.js";
import { broker } from "./commands/broker.js";
import { notifications } from "./commands/notifications.js";
import { invoices } from "./commands/invoices.js";
import { billing } from "./commands/billing.js";
import { upgrade } from "./commands/upgrade.js";
import { cancel } from "./commands/cancel.js";
import { nameservers } from "./commands/nameservers.js";
import { update } from "./commands/update.js";
import { uninstall } from "./commands/uninstall.js";
import { schema } from "./commands/schema.js";
import { cardList, cardAdd, cardRemove } from "./commands/card.js";
import { workspace } from "./commands/workspace.js";
import { serveMcpBridge } from "./mcp-bridge.js";
const program = new Command();

program
  .name("domani")
  .description(`Domain names for developers and AI agents - ${APP_DOMAIN}`)
  .version(CLI_VERSION)
  .option("--api-url <url>", "Override API base URL")
  .configureOutput({
    outputError: (str, write) => {
      // Strip Commander's "error: " prefix, we'll reformat it
      const msg = str.replace(/^error:\s*/i, "").trimEnd();
      write(`${pc.red("✗")} ${msg}\n`);
      // Suggest help for unknown option / missing argument errors
      if (/unknown option|missing required|expected argument/i.test(msg)) {
        const sub = process.argv[2];
        const helpCmd = sub && !sub.startsWith("-") ? `domani ${sub} --help` : "domani --help";
        write(`${pc.dim(`  Run \`${helpCmd}\` to see available options.`)}\n`);
      }
    },
  })
  .hook("preAction", async (thisCommand, actionCommand) => {
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

    // Ensure auth before any authenticated command runs.
    // before any command spinner starts, so clack doesn't conflict.
    const publicCommands = ["login", "logout", "search", "suggest", "tlds", "whois", "schema", "update", "uninstall", "mcp"];
    if (!publicCommands.includes(actionCommand.name())) {
      await ensureAuth();
    }
  });

// ── Auth ──────────────────────────────────────────────

program
  .command("login")
  .description(`Log in to ${APP_DOMAIN} (opens browser)`)
  .option("--json", "Output as JSON (returns auth_url for non-interactive approval)")
  .option("--no-open", "Don't open browser (print URL instead)")
  .option("--scopes <scopes>", "Request a comma-separated, least-privilege scope set")
  .option("--label <label>", "Human-readable label shown on the approval screen")
  .option("--expires-in <seconds>", "Delegated credential lifetime in seconds (3600-31536000)")
  .addHelpText("after", `
Examples:
  domani login                          # interactive login (opens browser)
  domani login --scopes domains:read,search --label "Project agent" --expires-in 86400
  domani login --json                   # non-interactive (returns auth_url)
  domani login --no-open                # print login URL without opening browser
  DOMANI_API_KEY=domani_sk_xxx domani list  # skip login, use env var`)
  .action(login);

program
  .command("logout")
  .description("Clear saved credentials")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .action(logout);

program
  .command("me")
  .description("Show account info")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani me                             # show account overview
  domani me --json                      # machine-readable account info
  domani me --json --fields email,plan  # just email and plan`)
  .action(me);

program
  .command("invoices")
  .description("List payment invoices")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .option("--limit <n>", "Max invoices to show (default 20)")
  .action(invoices);

program
  .command("card [action]")
  .description("Manage payment methods (list, add, remove)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .option("--yes", "Skip confirmation prompt (for remove)")
  .action(async (action, options) => {
    if (!action || action === "list") return cardList(options);
    if (action === "add") return cardAdd(options);
    if (action === "remove") return cardRemove(options);
    fail(`Unknown action: ${action}`, { hint: "Use: domani card list, domani card add, or domani card remove" });
  });

program
  .command("upgrade")
  .description("Upgrade to Pro: 10,000 emails/month, unlimited mailboxes, API/MCP/CLI access")
  .option("--json", "Output as JSON (returns checkout URL)")
  .action(upgrade);

program
  .command("cancel")
  .description("Cancel Pro subscription (access continues until end of billing period)")
  .option("--json", "Output as JSON")
  .action(cancel);

// Hidden alias for backwards compatibility
program
  .command("billing", { hidden: true })
  .option("--json", "Output as JSON (returns checkout URL)")
  .action(billing);

program
  .command("token")
  .description("Print your API key (masked on a terminal; --reveal for the full key)")
  .option("--json", "Output as JSON")
  .option("--reveal", "Print the full key even on an interactive terminal")
  .action(token);

program
  .command("mcp [action]")
  .description("Run the secure local MCP bridge (stdio)")
  .option("--verbose", "Write bridge lifecycle messages to stderr")
  .addHelpText("after", `
Examples:
  domani login                          # authenticate once in your browser
  domani mcp serve                      # stdio bridge for agent plugins

The bridge reads the API token from the OS keychain. It never prints the token
or places it in an MCP/plugin configuration file.`)
  .action(async (action, options) => {
    if (action && action !== "serve") {
      fail(`Unknown action: ${action}`, { hint: "Use: domani mcp serve" });
      return;
    }
    await serveMcpBridge({ verbose: options.verbose });
  });

program
  .command("tokens [action]")
  .description("Manage API tokens (list/create/revoke)")
  .option("--name <name>", "Token name (for create)")
  .option("--scopes <scopes>", "Comma-separated permission scopes (for create)")
  .option("--expires-in <seconds>", "Token lifetime in seconds (for create, min 3600)")
  .option("--agent-identity <id>", "Bind this token to an owned agent identity")
  .option("--token-id <id>", "Token ID (for revoke)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani tokens list                                    # list all tokens
  domani tokens create --name "CI" --scopes "domains:read,search"
  domani tokens create --name "Support agent" --agent-identity agent_abc123
  domani tokens revoke --token-id tok_abc123`)
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
  .addHelpText("after", `
Examples:
  domani search myapp                   # check popular TLDs
  domani search myapp .io .fm .xyz      # specific TLDs
  domani search myapp --expand          # check 30+ TLDs
  domani search myapp --max-price 20    # only affordable options
  domani search myapp --json            # machine-readable output`)
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
  .addHelpText("after", `
Examples:
  domani suggest "cat sitting marketplace"
  domani suggest "AI code editor" --style creative --tlds ai,dev
  domani suggest "meditation app" --lang japanese --count 5`)
  .action(suggest);

// ── Registration ──────────────────────────────────────

program
  .command("buy [domains...]")
  .description("Purchase one or more domains")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani buy myapp.dev                          # buy one domain
  domani buy myapp.dev myapp.com myapp.ai       # buy multiple
  domani buy myapp.dev --dry-run                # preview without buying
  domani buy myapp.dev --yes                    # skip confirmation
  domani buy myapp.dev --json                   # machine-readable output`)
  .action(buy);

program
  .command("provision <domain>")
  .description("Give an agent a full identity: domain + mailbox + webhook in one call")
  .option("--slug <slug>", "Mailbox local part (e.g. 'hi' for hi@domain). Default 'hi'")
  .option("--name <name>", "Display name for outbound email")
  .option("--webhook <url>", "HTTPS URL to receive inbound email + domain events")
  .option("--years <n>", "Registration years (1-10, default 1)")
  .option("--payment-method <method>", "card, usdc, or balance")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani provision myagent.run                                 # domain + hi@ mailbox
  domani provision myagent.run --slug hey --name "My Agent"    # custom mailbox
  domani provision myagent.run --webhook https://me.dev/inbox  # + inbound webhook
  domani provision myagent.run --dry-run                       # preview`)
  .action(provision);

program
  .command("adopt <domain>")
  .description("Inspect an existing domain and plan the safest connection or transfer")
  .option("--json", "Output the complete machine-readable plan as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani adopt myapp.com
  domani adopt myapp.com --json`)
  .action(adopt);

program
  .command("transfer <domain>")
  .description("Transfer a domain from another registrar")
  .option("--auth-code <code>", "EPP/auth code from current registrar")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani transfer myapp.com --auth-code ABC123XYZ
  domani transfer myapp.com --auth-code ABC123XYZ --dry-run
  domani transfer myapp.com --auth-code ABC123XYZ --yes`)
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
  .addHelpText("after", `
Examples:
  domani import myapp.com               # start import (shows TXT record to add)
  domani import myapp.com --verify      # verify TXT record and complete import`)
  .action(importDomain);

program
  .command("sell <domain>")
  .description("List a domain for sale (verify ownership via TXT record)")
  .option("--price <amount>", "Sale price in USD")
  .option("--verify", "Verify DNS ownership and activate listing")
  .option("--transfer-code <code>", "Submit transfer/auth code for an active deal")
  .option("--cancel", "Remove domain from sale")
  .option("--status", "Check listing status")
  .option("--description <text>", "Listing description")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani sell myapp.dev --price 5000                    # list for $5,000
  domani sell myapp.dev --price 5000 --description "Great brand name"
  domani sell external.com --price 2000                 # external domain (needs TXT verify)
  domani sell external.com --verify                     # verify TXT record
  domani sell myapp.dev --status                        # check listing status
  domani sell myapp.dev --cancel                        # remove from sale
  domani sell myapp.dev --transfer-code ABC123          # provide EPP code for a deal`)
  .action(sell);

// ── Management ────────────────────────────────────────

program
  .command("list")
  .alias("domains")
  .description("List your domains")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani list                           # list all domains
  domani domains                        # alias for list
  domani list --json --fields domain,expires_at`)
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
  .addHelpText("after", `
Examples:
  domani connect --list                                 # list providers
  domani connect myapp.dev vercel                       # connect to Vercel
  domani connect myapp.dev --provider google-workspace  # connect Google Workspace
  domani connect myapp.dev vercel --dry-run             # preview DNS changes`)
  .action(connect);

program
  .command("email [action] [arg2]")
  .description("Manage email: inbox lifecycle, mailboxes, send, forwarding, webhooks and setup")
  .addHelpText("after", `
Examples:
  domani email list                                 # list all mailboxes
  domani email create --domain myapp.dev --slug hi  # create hi@myapp.dev
  domani email inbox --from hi@myapp.dev            # view inbox
  domani email folders hi@myapp.dev                 # folder counts
  domani email archive hi@myapp.dev --message-ids m1,m2
  domani email send --from hi@myapp.dev --to bob@x.com --subject "Hello" --text "Hi Bob"
  domani email setup myapp.dev                      # setup email for domain
  domani email status myapp.dev                     # check email DNS health
  domani email delete --domain myapp.dev --slug hi  # delete mailbox`)
  .option("--domain <domain>", "Domain name")
  .option("--slug <slug>", "Mailbox slug (local part before @)")
  .option("--from <email>", "Sender address user@domain (alternative to --domain + --slug)")
  .option("--to <email>", "Recipient email address (for send)")
  .option("--cc <emails>", "CC recipients, comma-separated (for send)")
  .option("--bcc <emails>", "BCC recipients, comma-separated (for send)")
  .option("--subject <s>", "Email subject (for send)")
  .option("--title <s>", "Email subject (alias for --subject)")
  .option("--text <t>", "Email body text (for send)")
  .option("--body <t>", "Email body text (alias for --text)")
  .option("--in-reply-to <message-id>", "Message-ID of email being replied to (for threading)")
  .option("--references <message-ids>", "Space-separated Message-ID chain (for threading)")
  .option("--url <url>", "Webhook URL (for webhook)")
  .option("--forward-to <email>", "Email address to forward inbound emails to (for forward)")
  .option("--direction <dir>", "Filter messages: in or out")
  .option("--folder <folder>", "System folder: inbox, archive, sent, spam, trash")
  .option("--view <view>", "Virtual view: starred or all")
  .option("--message-ids <ids>", "Comma-separated message IDs for lifecycle actions")
  .option("--mailbox-ids <ids>", "Comma-separated mailbox IDs for shared inbox work")
  .option("--workspace <id>", "Create the mailbox inside this workspace (owner-only)")
  .option("--thread-key <key>", "Stable email thread key")
  .option("--thread-aliases <keys>", "Comma-separated legacy thread keys returned by the inbox")
  .option("--status <status>", "Workflow status: open, waiting, or closed")
  .option("--assigned <filter>", "Assignment filter: mine, unassigned, or all")
  .option("--assignee-type <type>", "Assignee type: member, token, or agent")
  .option("--assignee-id <id>", "Assignee ID")
  .option("--conversation-id <id>", "Conversation state ID")
  .option("--note <text>", "Private note text")
  .option("--if-version <number>", "Conversation version for compare-and-set updates")
  .option("--idempotency-key <key>", "Stable retry key for mailbox lifecycle actions")
  .option("--client-id <id>", "Stable opaque ID for this app installation or agent process")
  .option("--lease-id <id>", "Compose lease returned by a presence heartbeat")
  .option("--mode <mode>", "Presence mode: viewing or composing")
  .option("--no-acquire-lease", "Advertise composing presence without acquiring the primary lease")
  .option("--limit <n>", "Limit results")
  .option("--cursor <cursor>", "Opaque pagination or synchronization cursor")
  .option("--check", "Verify email DNS health (MX, SPF, DKIM, DMARC)")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(email);

program
  .command("workspace [action]")
  .description("Manage shared workspaces, members, and mailbox access")
  .option("--id <id>", "Workspace ID")
  .option("--name <name>", "Workspace name")
  .option("--email <email>", "Collaborator email")
  .option("--role <role>", "Workspace role: admin or member")
  .option("--mailboxes <ids>", "Comma-separated mailbox IDs")
  .option("--mailbox-role <role>", "Mailbox role: viewer, responder, or manager")
  .option("--token <token>", "Invitation token")
  .option("--membership-id <id>", "Target workspace membership ID")
  .option("--invitation-id <id>", "Pending workspace invitation ID")
  .option("--transfer-id <id>", "Pending ownership transfer ID")
  .option("--mailbox-id <id>", "Mailbox ID to adopt into the workspace")
  .option("--plan <plan>", "Mailzero plan: mail_solo, mail_team, or mail_business")
  .option("--no-open", "Do not open checkout in a browser")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani workspace list
  domani workspace create --name Acme
  domani workspace show --id ws_123
  domani workspace rename --id ws_123 --name "Customer support"
  domani workspace invite --id ws_123 --email person@example.com --mailboxes mb_1,mb_2
  domani workspace accept --token <invitation-token>
  domani workspace grant --id ws_123 --mailbox-id mb_1 --membership-id mem_1 --role responder
  domani workspace transfer --id ws_123 --membership-id mem_123
  domani workspace accept-ownership --token <ownership-token>
  domani workspace adopt-mailbox --id ws_123 --mailbox-id mb_123
  domani workspace checkout --id ws_123 --plan mail_team`)
  .action(workspace);

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
  .addHelpText("after", `
Examples:
  domani dns myapp.dev get                                          # list all records
  domani dns myapp.dev set --type A --name @ --value 76.76.21.21    # add A record
  domani dns myapp.dev set --type CNAME --name www --value cname.vercel-dns.com
  domani dns myapp.dev delete --type A --name @
  domani dns myapp.dev snapshot                                     # export DNS as JSON
  domani dns myapp.dev restore --file dns-backup.json               # restore from snapshot`)
  .action(dns);

program
  .command("nameservers [domain] [ns...]")
  .alias("ns")
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
  .addHelpText("after", `
Examples:
  domani settings myapp.dev                         # view current settings
  domani settings myapp.dev --auto-renew on         # enable auto-renew
  domani settings myapp.dev --whois-privacy on      # enable WHOIS privacy
  domani settings myapp.dev --security-lock off     # unlock for transfer`)
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
  .addHelpText("after", `
Examples:
  domani contact                        # view current contact info
  domani contact set --first-name John --last-name Doe --address1 "123 Main St" \\
    --city "San Francisco" --state CA --postal-code 94102 --country US --phone +1.5551234567 --email john@example.com`)
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
  .addHelpText("after", `
Examples:
  domani parking myapp.dev                  # view parking status
  domani parking myapp.dev enable           # enable parking page
  domani parking myapp.dev disable          # disable parking page
  domani parking myapp.dev price 500        # set for-sale price to $500`)
  .action(parking);

program
  .command("analytics [domain]")
  .alias("stats")
  .description("View parking analytics (views, inquiries, conversion)")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(analytics);

program
  .command("webhooks [action]")
  .alias("webhook")
  .description("Manage webhook endpoints (list/create/update/delete/deliveries/replay/events)")
  .addHelpText("after", `
Examples:
  domani webhooks list
  domani webhooks create --url https://example.com/hook --events domain.purchased,domain.expiring
  domani webhooks update --webhook-id wh_abc --active off
  domani webhooks delete --webhook-id wh_abc
  domani webhooks deliveries --webhook-id wh_abc
  domani webhooks replay --webhook-id wh_abc --delivery-id del_abc --idempotency-key incident-2026-07-25
  domani webhooks events                                # list available event types`)
  .option("--url <url>", "Webhook HTTPS URL")
  .option("--events <events>", "Comma-separated event types")
  .option("--webhook-id <id>", "Webhook ID (for update/delete/deliveries)")
  .option("--delivery-id <id>", "Webhook delivery ID (for replay)")
  .option("--idempotency-key <key>", "Stable idempotency key (for replay)")
  .option("--active <on|off>", "Enable or disable webhook")
  .option("--limit <n>", "Limit deliveries returned")
  .option("--dry-run", "Show what would happen without executing")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(webhooks);

program
  .command("deals [id]")
  .description("List marketplace deals or view deal details")
  .option("--role <role>", "Filter by role: buyer or seller")
  .option("--status <status>", "Filter by status: active, completed, or all")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Examples:
  domani deals                                  # list all your deals
  domani deals --role seller --status active     # your active sales
  domani deals deal_abc123                       # view specific deal
  domani deals --json                            # machine-readable output`)
  .action(deals);

program
  .command("broker [action] [arg]")
  .description("Acquire a taken, unlisted domain (broker sources + negotiates on your behalf)")
  .option("--max-budget <amount>", "Your ceiling in USD for a request")
  .option("--status <status>", "Filter the list by status")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .addHelpText("after", `
Actions:
  request <domain>    ask domani to acquire a taken domain (commission-only)
  list (default)      list your acquisition requests
  status <id>         view one request's progress
  cancel <id>         cancel an active request

Examples:
  domani broker request dream.com --max-budget 5000
  domani broker                                  # list your requests
  domani broker status brq_abc123
  domani broker cancel brq_abc123`)
  .action((action, arg, options) => broker(action, arg, options));

program
  .command("notifications")
  .alias("notifs")
  .description("View notifications or mark all as read")
  .option("--read", "Mark all notifications as read")
  .option("--unread", "Show only unread notifications")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action(notifications);

// ── Email shortcuts ───────────────────────────────────

program
  .command("send [arg2]")
  .description("Send an email - shortcut for: domani email send")
  .option("--from <email>", "Sender address user@domain")
  .option("--to <email>", "Recipient email address")
  .option("--cc <emails>", "CC recipients, comma-separated")
  .option("--bcc <emails>", "BCC recipients, comma-separated")
  .option("--subject <s>", "Email subject")
  .option("--title <s>", "Email subject (alias for --subject)")
  .option("--text <t>", "Email body text")
  .option("--body <t>", "Email body text (alias for --text)")
  .option("--in-reply-to <message-id>", "Message-ID of email being replied to")
  .option("--references <message-ids>", "Space-separated Message-ID chain")
  .option("--domain <domain>", "Domain name")
  .option("--slug <slug>", "Mailbox slug")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action((arg2, options) => email("send", arg2, options));

program
  .command("inbox [arg2]")
  .description("View email inbox - shortcut for: domani email inbox")
  .option("--from <email>", "Sender address user@domain")
  .option("--domain <domain>", "Domain name")
  .option("--slug <slug>", "Mailbox slug")
  .option("--direction <dir>", "Filter messages: in or out")
  .option("--limit <n>", "Limit results")
  .option("--json", "Output as JSON")
  .option("--fields <fields>", "Filter JSON output fields (comma-separated)")
  .action((arg2, options) => email("inbox", arg2, options));

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
