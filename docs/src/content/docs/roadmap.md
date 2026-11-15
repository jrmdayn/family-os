---
title: Roadmap
description: The milestones that take Family OS from an empty repository to the babysitting ledger in daily use.
---

Each milestone ends with something you can try. The docs grow with every milestone.

## M0: Repository setup

Any session, in the cloud or on a laptop, starts with the right tools, reference sources and conventions.

- [x] pnpm workspace on Node 24, with one catalog pinning alchemy, `@alchemy.run/*`, Effect and Foldkit.
- [x] TypeScript, vitest with `@effect/vitest`, oxlint and oxfmt.
- [x] `repos/` holds the Alchemy, Effect and Foldkit sources at the versions we install.
- [x] Agent skills: `alchemy-domain` (linked by pnpm) and Foldkit's skills (linked from `repos/foldkit`).
- [x] A SessionStart hook installs dependencies and syncs `repos/` in cloud sessions.
- [x] `AGENTS.md` with the project conventions.
- [x] Empty `domain`, `server` and `web` packages, and this docs site.
- [x] CI runs typecheck, lint, format and tests, and builds the docs.

**Done when** a fresh cloud session can run `pnpm check`, has the skills loaded and can read Alchemy's source.

## M1: Domain model, in memory

No Cloudflare account needed.

- [ ] Check that `LogShift`, decided by the `Sitter` aggregate, can read the current rate from `RateCard`.
- [ ] `RateCard` aggregate (one instance): `SetHourlyRate`.
- [ ] `Sitter` aggregate (one per babysitter): `RegisterSitter`, `UpdateSitter`, `ArchiveSitter`, `LogShift`, `CorrectShift`, `CancelShift`, `RecordPayment`.
- [ ] Views: `SitterBalance`, `SitterStatement`, `Payouts`, `SitterDirectory`.
- [ ] `OwnerApi`, with descriptions written for an LLM: ISO dates, Europe/Paris, amounts in cents, replies that echo what was recorded.
- [ ] Stories for every rule, and Api tests.
- [ ] A local CLI over the Api, on `Domain.InMemory`.
- [ ] Docs: glossary, a map of the model, decisions.

**Done when** you can register Maria, log "4h on Friday" and see what you owe her, from the terminal.

## M2: Cloudflare and MCP

Needs a Cloudflare account and an API token stored as a GitHub secret.

- [ ] Server Worker: the model on Durable Objects, `/api` with OpenAPI, `/mcp`.
- [ ] A temporary bearer token, to call the MCP endpoint from Claude Code before OAuth exists.
- [ ] Alchemy remote state, `dev` and `prod` stages, deploys from GitHub Actions.
- [ ] This docs site deployed publicly by the same stack.
- [ ] Docs: infrastructure, and the "Maria 4h on Friday" walkthrough.

**Done when** Claude Code logs a shift in `dev`, and the docs are online.

## M3: Sign-in, and Claude on web and mobile

Needs a Google OAuth client.

- [ ] better-auth with Google sign-in, stored in D1, restricted to an allowlist of emails.
- [ ] `@better-auth/oauth-provider`, so a Claude.ai custom connector can sign in. Fallback: `@cloudflare/workers-oauth-provider`.
- [ ] One `Session` middleware accepting the web cookie or the OAuth token, both resolving to the owner.
- [ ] Check that Claude.ai accepts the sessionless MCP protocol (`v2026_07_28`); fall back to `v2025_11_25` if not.
- [ ] Docs: signing in a Claude connector, with a sequence diagram; runbook for connecting Claude.ai.

**Done when** "Maria 4h on Friday" and "What do I need to wire to whom?" work from Claude on a phone and in the browser.

## M4: Notion import and go-live

Needs the CSV export of the Notion database.

- [ ] `scripts/import-notion.ts` replays the full history, keeping each shift's rate and each payment's date.
- [ ] A dry run prints each sitter's computed balance next to the balance in Notion.
- [ ] Import into `prod` once they match.

**Done when** every balance matches Notion and babysitting no longer lives in Notion.

## M5: Web app

- [ ] Foldkit app: this week's payouts with IBANs to copy, a statement per sitter, a form to log a shift, a "mark paid" button.
- [ ] Live updates through Domain's Foldkit integration, sharing the session cookie on the same origin.

## Later

- A Sunday reminder: "You owe Maria €180, Ana €60".
- A runbook for the yearly rate change.
- The next chore, as a new folder in the domain package. Its commands and views become MCP tools without extra work.
