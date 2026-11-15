---
title: Local development
description: Run Family OS on your machine, drive it from the terminal, and test it.
---

## Run it

```sh
pnpm dev
```

This starts `packages/server/src/dev.ts`: the whole model in memory, on `http://localhost:8787`, behind the same routes as the [server Worker](/building/deploying/#the-server-worker): `/rpc` for `fos`, `/api` for plain HTTP (OpenAPI at `/api/openapi.json`) and `/mcp` for Claude. Its state is lost when it stops.

The dev server checks a bearer token like the deployed one: `FAMILY_OS_TOKEN`, `dev-token` by default.

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

`FAMILY_OS_URL` points the CLI elsewhere (default `http://localhost:8787`), and `FAMILY_OS_TOKEN` sets its token. The CLI calls `$FAMILY_OS_URL/rpc`, so the same command reaches a deployed stage:

```sh
FAMILY_OS_URL=https://family-os.jrmdayn.workers.dev FAMILY_OS_TOKEN=<token> pnpm fos payouts get --key home
```

The CLI is built with Domain's `toCli` in `packages/cli/src/fos.ts`. It publishes `ownerCalls` from `OwnerApi.api.ts`, the same list `/api` and `/mcp` publish.

## Plain HTTP

```sh
curl -X POST http://localhost:8787/api/LogShift \
  -H 'authorization: Bearer dev-token' -H 'content-type: application/json' \
  -d '{"target":"maria","input":{"date":"2026-11-13","minutes":240}}'
curl http://localhost:8787/api/Payouts/home -H 'authorization: Bearer dev-token'
```

A command answers with its receipt (`reply`, `stream`, `version`), a rejection with `422` and its JSON, a missing or wrong token with `401`.

## Claude Code over MCP

Add the dev server as an MCP server, then ask Claude "Maria 4h on Friday":

```sh
claude mcp add --transport http family-os http://localhost:8787/mcp \
  --header "Authorization: Bearer dev-token"
```

Each command and read is a tool named `OwnerApi_<Name>_<operation>`, with the command's description as the tool description. A deployed stage works the same way with its own URL and token. The [walkthrough](/building/walkthrough/) follows a whole conversation, with each tool call and its result.

Scripts run as TypeScript directly: Node 24 strips the types, so there is no build step. `erasableSyntaxOnly` in `tsconfig.base.json` keeps the code within what Node can strip.

## Test it

```sh
pnpm test
```

- **Stories** (`packages/domain/test/`): the business rules, against the model in memory.
- **Api tests** (`packages/server/test/`): the `OwnerApi` as a client sees it, with the real session middleware: a full flow, a typed rejection, and wrong tokens refused. `Routes.test.ts` sends HTTP requests to the routes the Worker serves (`/rpc`, `/api`, `/api/openapi.json`, `/mcp`) with the model in memory. `Session.test.ts` checks that a missing or short `FAMILY_OS_TOKEN` is refused.

## How the packages fit

```text
packages/domain   the model, its Session middleware declaration and the OwnerApi
packages/server   Session.ts (bearer token check), Routes.ts (/rpc, /api, /mcp),
                  FamilyOsWorker.ts (on Cloudflare) and dev.ts (the local server)
packages/cli      fos.ts, the CLI
```
