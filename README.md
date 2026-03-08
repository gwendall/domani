# domani

Domain infrastructure for AI agents. Search, register, DNS, email, connect — all from your terminal.

[![npm version](https://img.shields.io/npm/v/domani.svg)](https://www.npmjs.com/package/domani)
[![license](https://img.shields.io/npm/l/domani.svg)](https://github.com/gwendall/domani/blob/main/LICENSE)

## Install

```bash
npm install -g domani
```

Or run directly with `npx`:

```bash
npx domani search myapp .com .dev .ai
```

## Quick start

```bash
domani login                          # Log in (opens browser)
domani search myapp .com .io .dev     # Check availability
domani buy myapp.dev                  # Purchase a domain
domani connect myapp.dev vercel       # Auto-configure DNS for Vercel
domani email setup myapp.dev          # Set up email
domani email send --domain myapp.dev --to hi@friend.com --subject "Hello" --text "Sent from my terminal"
domani status myapp.dev               # Health check (DNS, SSL, email, expiry)
```

## Commands

### Discovery

```
domani search <name> [tlds...]    Check availability across TLDs (--expand for 30+)
domani suggest <prompt>           AI-powered domain suggestions (--style, --lang, --tlds)
domani tlds                       List all TLDs with pricing (--sort, --max-price)
domani whois <domain>             WHOIS/RDAP lookup
```

### Registration

```
domani buy <domains...>           Purchase one or more domains (card or USDC)
domani transfer <domain>          Transfer from another registrar
domani renew <domain>             Renew a domain (--years 1-10)
domani import <domain>            Import a domain you own elsewhere (DNS monitoring only)
```

### DNS

```
domani dns <domain> get            List all DNS records
domani dns <domain> set <type> <name> <value>   Add/update a record
domani dns <domain> delete <type> <name>        Remove a record
domani dns <domain> snapshot       Export DNS to file
domani dns <domain> restore        Restore DNS from snapshot
domani nameservers <domain>        Get or set nameservers (--reset for defaults)
domani connect <domain> <target>   Auto-configure DNS for a provider
```

**Supported providers**: Vercel, Netlify, Cloudflare Pages, GitHub Pages, Fly.io, Railway, Render, Google Workspace, Fastmail, Proton Mail.

### Email

```
domani email setup <domain>         Set up email (MX, SPF, DKIM, DMARC auto-configured)
domani email status <domain>        Check email DNS health
domani email list --domain <d>      List mailboxes
domani email create --domain <d> --slug hello   Create hello@domain
domani email delete --domain <d> --slug hello   Delete a mailbox
domani email send                   Send an email (--to, --subject, --text, --cc, --bcc)
domani email messages --domain <d>  List messages (--direction in|out)
domani email forward                Forward inbound to a personal address
domani email webhook                Forward inbound as JSON to your endpoint
domani email connect <domain> <provider>   Connect external email (Gmail, Fastmail, Proton)
```

### Domain settings

```
domani status <domain>             Health check (DNS, SSL, email, expiry)
domani settings <domain>           View/update auto-renew, WHOIS privacy, security lock
domani contact [view|set]          Manage WHOIS contact info
domani parking <domain>            Manage parking page (enable/disable/price)
domani analytics <domain>          View parking analytics
domani auth-code <domain>          Get EPP auth code for outbound transfer
domani transfer-away <domain>      Check outbound transfer status
```

### Account

```
domani login                       Log in to domani.run (opens browser)
domani logout                      Clear saved credentials
domani me                          Show account info
domani billing                     Add or update payment method (opens browser)
domani invoices                    List payment invoices
domani token                       Print your API key
domani tokens [list|create|revoke] Manage API tokens (scoped, expiring)
domani webhooks [action]           Manage webhook endpoints
```

### Introspection

```
domani schema [command]            Show command schemas for AI agent integration
domani update                      Update to the latest version
domani uninstall                   Remove domani CLI and config
```

## Agent-friendly

Built for AI agents and scripts, not just humans.

**Auto-detect**: When stdout is not a terminal, the CLI automatically switches to JSON output and skips confirmation prompts. No flags needed.

```bash
domani list | jq '.domains[].domain'
```

**Structured errors**: In JSON mode, errors include `code`, `hint`, and `fix_command` for auto-recovery:

```json
{ "error": "Not logged in", "code": "auth_required", "fix_command": "domani login" }
```

**Flags**:
- `--json` — Force JSON output
- `--fields <f>` — Filter JSON fields (comma-separated)
- `--dry-run` — Preview mutations without executing
- `--yes` — Skip confirmation prompts

**Input hardening**: All inputs are validated against path traversal, control characters, query strings, and double encoding — common agent hallucinations that could cause issues.

## Payments

Supports both card and USDC (Base/Ethereum). The CLI auto-detects which method the user has set up.

```bash
domani buy myapp.dev                     # Uses saved card
domani buy myapp.dev --payment usdc      # Pay with USDC
```

[x402](https://www.x402.org/) protocol support lets agents pay autonomously.

## Authentication

```bash
domani login                             # Interactive (opens browser)
export DOMANI_API_KEY=domani_sk_...      # Or set env var
```

The CLI checks `$DOMANI_API_KEY` first, then falls back to `~/.domani/config.json`.

## Integrations

Everything the CLI does is also available via:

- **REST API** — [domani.run/docs](https://domani.run/docs)
- **MCP Server** — Works with Claude Code, Cursor, Windsurf, and any MCP-compatible agent
- **Agent Skill** — Install as a Claude Code skill: `npx skills add domani.run`
- **CONTEXT.md** — Agent decision guide: [domani.run/CONTEXT.md](https://domani.run/CONTEXT.md)

Learn more at [domani.run](https://domani.run).

## License

[MIT](LICENSE)
