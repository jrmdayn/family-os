# Family OS: notes for coding agents

Family OS is a household admin app used mainly through an LLM over MCP. The first chore it handles is the babysitting ledger: shifts, one shared hourly rate, and Sunday payouts. Stack: Cloudflare, Alchemy + Alchemy Domain, Foldkit, Effect v4.

The docs site (`docs/`) explains how everything is built. The roadmap is at `docs/src/content/docs/roadmap.md`, and decisions are at `docs/src/content/docs/decisions.md`.

## Look things up in `repos/`, don't guess

Alchemy, Alchemy Domain, Effect v4 and Foldkit are recent, so memory of their APIs is often wrong. `repos/` holds their source at the exact versions we install (run `pnpm repos:sync` if it is missing). Read it before writing code against these libraries:

- Domain manual: `repos/alchemy/website/src/content/docs/domain/`
- Domain source: `repos/alchemy/packages/domain/src/`
- Full Domain app on Cloudflare + Foldkit: `repos/alchemy/examples/cloudflare-domain/`
- Domain + better-auth: `repos/alchemy/examples/cloudflare-domain-better-auth/`
- Effect: `repos/effect/packages/effect/src/`
- Foldkit: `repos/foldkit/packages/foldkit/src/`, `repos/foldkit/examples/`

`repos/` is read-only and gitignored. Never import from it.

Skills: `alchemy-domain` (domain modeling, layout, stories, Cloudflare hosting) and `foldkit` / `generate-program` / `audit-program` (the web app) are linked in `.claude/skills/`. Use them.

## Layout and conventions

- `packages/domain` imports only `@alchemy.run/domain` and `effect`. No Cloudflare, no IO.
- `packages/server` hosts the model and implements what it depends on (session middleware, local dev server). `packages/cli` is `fos`, the Api from a terminal. `packages/web` is the Foldkit app. `docs/` is the Astro + Starlight site.
- The babysitting ledger is one `Sitter` aggregate per babysitter, keyed by the sitter's id, plus a `RateCard` aggregate (id `home`) holding the household rate, which policies copy to the sitters (see `docs/src/content/docs/building/babysitting-model.md`). Decisions are pure: they read only their aggregate's state and `now`.
- Follow Alchemy Domain's project layout: one folder per subdomain (`Babysitting/`), one file per building block named `<Noun>.<kind>.ts` (`LogShift.command.ts`, `Sitter.aggregate.ts`, `Payouts.view.ts`, `OwnerApi.api.ts`, `Session.middleware.ts`). A command shares its file with its events and the rejections only it returns.
- Money is integer cents (EUR). Durations are integer minutes. Dates are ISO `YYYY-MM-DD`, Europe/Paris.
- Every command and view carries a `description` annotation written for an LLM: it becomes the MCP tool description.
- Every business rule gets a story (`Story.given / when / then`). Api access gets an Api test.
- Dependency versions live only in the `catalog:` of `pnpm-workspace.yaml`. Packages refer to `catalog:`. After bumping alchemy, effect or foldkit, run `pnpm repos:sync`.

## Commands

```sh
pnpm install
pnpm check         # typecheck + lint + format check + tests
pnpm test
pnpm dev           # local server, model in memory, http://localhost:8787
pnpm fos --help    # CLI against it (FAMILY_OS_URL, FAMILY_OS_TOKEN)
pnpm format
pnpm docs:dev
pnpm repos:sync
pnpm exec alchemy plan --stage prod   # what a deploy would change (CI deploys prod on push to main, pr-<n> per pull request)
```

In a Claude Code cloud session, prefix Alchemy commands with `NODE_USE_ENV_PROXY=1`: otherwise Node bypasses the network proxy and Alchemy fails with "Transport error".

pnpm downloads Node 24 by itself (`devEngines`), so run scripts through pnpm.

## Docs

When a change affects how the app is built, update the matching page in `docs/` in the same change. Record notable choices in `docs/src/content/docs/decisions.md`, newest first. Tick roadmap items as they land.
