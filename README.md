# domani

Domain names for developers and AI agents. Search, buy, manage DNS, and connect - all from your terminal.

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
domani connect myapp.dev vercel       # Set up DNS for Vercel
domani status myapp.dev               # Check domain health
```

## Commands

### Discovery

```
domani search <name> [tlds...]    Check availability across TLDs
domani suggest <prompt>           AI-powered domain name suggestions
domani tlds                       List all TLDs with pricing
domani whois <domain>             WHOIS/RDAP lookup
```

### Registration

```
domani buy <domains...>           Purchase one or more domains
domani transfer <domain>          Transfer from another registrar (pre-checks eligibility)
domani renew <domain>             Renew a domain
domani import <domain>            Import a domain you own elsewhere
```

### Management

```
domani list                       List your domains
domani status <domain>            DNS, SSL, email, expiry health check
domani dns <domain> [action]      Manage DNS records (get/set/delete)
domani nameservers <domain>       Get or set nameservers (--reset for defaults)
domani connect <domain> <target>  Auto-configure DNS for a provider
domani email <domain> [provider]  Set up email (Google Workspace, Fastmail, Proton)
domani email send                 Send email (--cc, --bcc, --in-reply-to, --references)
domani email forward              Forward inbound emails to a personal address
domani settings <domain>          Auto-renew, WHOIS privacy, security lock
domani contact [view|set]         Manage WHOIS contact info
domani parking <domain>           Manage parking page
domani webhooks [action]          Manage webhook endpoints
```

### Account

```
domani login                      Log in to domani.run
domani logout                     Clear saved credentials
domani me                         Show account info
domani billing                    Add or update payment method (opens browser)
domani invoices                   List payment invoices
domani token                      Print your API key
```

### Introspection

```
domani schema [command]           Show command schemas for AI agent integration
```

## Flags

All commands support `--json` for machine-readable output, `--fields` to filter JSON fields, and `--dry-run` to preview mutations. Purchase commands support `--yes` to skip confirmation prompts.

**TTY auto-detect**: When stdout is not a terminal (piped or redirected), the CLI automatically switches to JSON output — no `--json` flag needed. This lets agents and scripts pipe output directly: `domani list | jq '.domains[].domain'`

In `--json` mode, errors return structured JSON with `code`, `hint`, and `fix_command` for auto-recovery.

## Input Hardening

All domain and TLD inputs are validated against common agent hallucinations:

- **Path traversal** (`../../.ssh`) — rejected
- **Control characters** (ASCII < 0x20) — rejected
- **Query strings / fragments** (`domain.com?fields=name`) — rejected
- **Double encoding** (`%2e%2e`) — rejected

Invalid input returns a structured error with `code: "invalid_input"` and a `hint` explaining the issue.

## Authentication

```bash
domani login                          # Interactive login (opens browser)
export DOMANI_API_KEY=domani_sk_...   # Or set API key as env var
```

The CLI checks `$DOMANI_API_KEY` first, then falls back to `~/.domani/config.json`.

## Integrations

Everything the CLI does is also available via:

- **REST API** - [domani.run/docs](https://domani.run/docs)
- **MCP Server** - Works with Claude Code, Cursor, Windsurf, OpenClaw, and any MCP-compatible agent
- **Agent Skill** - Install as a Claude Code skill

Learn more at [domani.run](https://domani.run).

## License

[MIT](LICENSE)
