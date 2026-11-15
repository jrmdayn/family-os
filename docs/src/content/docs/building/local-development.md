---
title: Local development
description: Run Family OS on your machine, drive it from the terminal, and test it.
---

## Run it

```sh
pnpm dev
```

This starts `packages/server/src/dev.ts`: the whole model in memory, behind the `OwnerApi` over HTTP, on `http://localhost:8787`. Its state is lost when it stops. In M2 the same model runs on Cloudflare instead.

The dev server checks a bearer token like the deployed one will: `FAMILY_OS_TOKEN`, `dev-token` by default.

## Drive it from the terminal

`pnpm fos` is the CLI. Every command and read of the `OwnerApi` is a subcommand, and its help is the description an LLM sees as the MCP tool description:

```sh
pnpm fos --help
pnpm fos set-hourly-rate --target home --cents-per-hour 1500 --effective-from 2026-01-01
pnpm fos register-sitter --target maria --name Maria --iban "FR76 3000 6000 0112 3456 7890 189"
pnpm fos sitter-balance get --key maria
pnpm fos log-shift --target maria --date 2026-11-13 --minutes 240
pnpm fos payouts get --key home
pnpm fos record-payment --target maria
pnpm fos sitter-statement list --key maria
```

A rejection prints as JSON on stderr and the command exits with code 1:

```json
{ "_tag": "DateInFuture", "date": "2030-01-01", "today": "2026-11-15" }
```

`FAMILY_OS_URL` points the CLI elsewhere (default `http://localhost:8787`), and `FAMILY_OS_TOKEN` sets its token. The CLI is built with Domain's `toCli` in `packages/cli/src/fos.ts`.

Scripts run as TypeScript directly: Node 24 strips the types, so there is no build step. `erasableSyntaxOnly` in `tsconfig.base.json` keeps the code within what Node can strip.

## Test it

```sh
pnpm test
```

- **Stories** (`packages/domain/test/`): the business rules, against the model in memory.
- **Api tests** (`packages/server/test/`): the `OwnerApi` as a client sees it, with the real session middleware: a full flow, a typed rejection, and wrong tokens refused.

## How the packages fit

```text
packages/domain   the model, its Session middleware declaration and the OwnerApi
packages/server   Session.ts (bearer token check) and dev.ts (the local server)
packages/cli      fos.ts, the CLI
```
