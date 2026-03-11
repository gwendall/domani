# domani

Domains and email - for humans and AI agents.

Register domains, manage DNS, create mailboxes, send and receive email. From your terminal, your agent, or the web.

[![npm version](https://img.shields.io/npm/v/domani.svg)](https://www.npmjs.com/package/domani)
[![license](https://img.shields.io/npm/l/domani.svg)](https://github.com/gwendall/domani/blob/main/LICENSE)

## How it works

domani gives you one account and multiple ways in:

- **[Web](https://domani.run)** - Dashboard with a full inbox (compose, reply, threads), DNS editor, domain management
- **CLI** - This package. Everything the web app does, from your terminal
- **[MCP Server](https://domani.run/mcp)** - 65 tools for Claude Code, Cursor, Windsurf, and any MCP-compatible agent
- **[OpenClaw](https://openclaw.com)** - `clawhub install domani`
- **[Agent Skill](https://domani.run/SKILL.md)** - Step-by-step guide your agent can follow. Install with `npx skills add domani.run`
- **[REST API](https://domani.run/docs)** - Direct HTTP access to everything

All interfaces share the same API key and the same data.

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
# Domain
domani search myapp .com .io .dev     # Check availability
domani buy myapp.dev                  # Purchase a domain
domani connect myapp.dev vercel       # Auto-configure DNS for Vercel

# Email
domani email create hello@myapp.dev               # Create hello@myapp.dev
domani email send hello@myapp.dev \
  --to hi@friend.com --subject "Hello" --body "Sent from my terminal"
domani email forward hello@myapp.dev \
  --forward-to me@gmail.com                        # Forward inbound to personal email

# Health
domani status myapp.dev               # DNS, SSL, email, expiry check
```

## Examples

```bash
# Find available domains with a budget
domani search startup --expand --max-price 20

# AI-powered name suggestions
domani suggest "minimalist productivity app" --style brandable --tlds com,dev,ai

# Buy multiple domains at once
domani buy startup.dev startup.ai --yes

# Set up Vercel + Google Workspace in two commands
domani connect startup.dev vercel
domani connect startup.dev google-workspace

# Full email workflow: create, send, check inbox, forward
domani email create hello@startup.dev
domani email send hello@startup.dev \
  --to investor@vc.com --subject "Deck" --body "Here's our deck."
domani email inbox hello@startup.dev --direction in
domani email forward hello@startup.dev --forward-to me@gmail.com

# Webhook for inbound emails (for bots, support systems, etc.)
domani email webhook hello@startup.dev --url https://myapp.dev/hooks/email

# Export DNS records before making changes
domani dns startup.dev snapshot
domani dns startup.dev set TXT @ "v=spf1 include:_spf.google.com ~all"

# Pipe to jq (auto-JSON when piped, no --json needed)
domani list | jq '.domains[] | {domain, expires_at}'

# Introspect command schemas for agent integration
domani schema buy --json
```

## Commands

### Domains

```bash
domani search <name> [tlds...]    # Check availability across TLDs (--expand for 30+)
domani suggest <prompt>           # AI-powered domain suggestions (--style, --lang, --tlds)
domani buy <domains...>           # Purchase one or more domains (card or USDC)
domani transfer <domain>          # Transfer from another registrar
domani renew <domain>             # Renew a domain (--years 1-10)
domani import <domain>            # Import a domain you own elsewhere (DNS monitoring only)
domani list                       # List your domains
domani status <domain>            # Health check (DNS, SSL, email, expiry)
domani tlds                       # List all TLDs with pricing (--sort, --max-price)
domani whois <domain>             # WHOIS/RDAP lookup
```

### Email

```bash
domani email list                    # List all mailboxes
domani email create user@domain      # Create a mailbox
domani email delete user@domain      # Delete a mailbox
domani email inbox user@domain       # List messages (--direction in|out)
domani email send user@domain        # Send an email (--to, --subject, --body, --cc, --bcc)
domani email forward user@domain     # Forward inbound to a personal address (--forward-to)
domani email webhook user@domain     # Forward inbound as JSON to your endpoint (--url)
domani email setup <domain>          # Auto-configure MX, SPF, DKIM, DMARC
domani email status <domain>         # Check email DNS health
domani email connect <domain> <provider>   # Connect external provider (Gmail, Fastmail, Proton)
```

### DNS

```bash
domani dns <domain> get            # List all DNS records
domani dns <domain> set <type> <name> <value>   # Add/update a record
domani dns <domain> delete <type> <name>        # Remove a record
domani dns <domain> snapshot       # Export DNS to file
domani dns <domain> restore        # Restore DNS from snapshot
domani nameservers <domain>        # Get or set nameservers (--reset for defaults)
domani connect <domain> <target>   # Auto-configure DNS for a provider
```

**Supported providers**: Vercel, Netlify, Cloudflare Pages, GitHub Pages, Fly.io, Railway, Render, Google Workspace, Fastmail, Proton Mail.

### Settings

```bash
domani settings <domain>           # View/update auto-renew, WHOIS privacy, security lock
domani contact [view|set]          # Manage WHOIS contact info
domani parking <domain>            # Manage parking page (enable/disable/price)
domani analytics <domain>          # View parking analytics
domani auth-code <domain>          # Get EPP auth code for outbound transfer
domani transfer-away <domain>      # Check outbound transfer status
```

### Account

```bash
domani login                       # Log in to domani.run (opens browser)
domani logout                      # Clear saved credentials
domani me                          # Show account info
domani billing                     # Add or update payment method (opens browser)
domani invoices                    # List payment invoices
domani token                       # Print your API key
domani tokens [list|create|revoke] # Manage API tokens (scoped, expiring)
domani webhooks [action]           # Manage webhook endpoints
```

### Introspection

```bash
domani schema [command]            # Show command schemas for AI agent integration
domani update                      # Update to the latest version
domani uninstall                   # Remove domani CLI and config
```

## Agent integration

Built for AI agents and scripts, not just humans.

**TTY auto-detect**: When stdout is not a terminal, the CLI automatically switches to JSON output and skips confirmation prompts. No `--json` flag needed.

```bash
domani list | jq '.domains[].domain'
```

**Structured errors**: In JSON mode, errors include `code`, `hint`, and `fix_command` for auto-recovery:

```json
{ "error": "Not logged in", "code": "auth_required", "fix_command": "domani login" }
```

| Code | Fix | Description |
|------|-----|-------------|
| `auth_required` | `domani login` | Not logged in |
| `payment_required` | `domani billing` | No payment method on file |
| `contact_required` | `domani contact set` | WHOIS contact info missing |
| `validation_error` | Read `hint` | Invalid input |
| `not_found` | - | Domain doesn't exist or not owned |
| `rate_limited` | Wait `Retry-After` | Too many requests |

**Flags**:

| Flag | Description |
|------|-------------|
| `--json` | Force JSON output |
| `--fields <f>` | Filter JSON fields (comma-separated) |
| `--dry-run` | Preview mutations without executing |
| `--yes` | Skip confirmation prompts |

**Input hardening**: All inputs are validated against path traversal, control characters, query strings, and double encoding - common agent hallucinations.

**Schema introspection**: Run `domani schema <command> --json` to get parameter types, constraints, and enums before constructing a command.

## Payments

Supports both card and USDC (Base / Ethereum). The CLI auto-detects which method the user has set up.

```bash
domani buy myapp.dev                     # Uses saved card
domani buy myapp.dev --payment usdc      # Pay with USDC
```

[x402](https://www.x402.org/) protocol support lets agents pay autonomously without human approval.

## Authentication

| Method | Description |
|--------|-------------|
| `domani login` | Interactive login (opens browser) |
| `$DOMANI_API_KEY` | API key as environment variable |
| `~/.domani/config.json` | Saved credentials from `domani login` |

The CLI checks `$DOMANI_API_KEY` first, then falls back to `~/.domani/config.json`.

```bash
domani login                             # Interactive (opens browser)
export DOMANI_API_KEY=domani_sk_...      # Or set env var
```

Scoped API tokens can be created with `domani tokens create --scopes read,dns --expires-in 86400`.

## Environment variables

| Variable | Description |
|----------|-------------|
| `DOMANI_API_KEY` | API key (takes precedence over saved config) |

## License

[MIT](LICENSE)
