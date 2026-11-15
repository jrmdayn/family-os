---
title: The repository
description: How the Family OS repository is laid out, which tools it uses, and how a coding agent gets the context it needs.
---

## Layout

```text
family-os/
  packages/
    domain/   @family-os/domain   the model, its Apis and its stories
    server/   @family-os/server   hosts the model (locally today, on Cloudflare from M2), owns sign-in
    cli/      @family-os/cli      fos, the Api from a terminal
    web/      @family-os/web      the Foldkit app
  docs/       @family-os/docs     this site (Astro + Starlight)
  scripts/    sync-repos.sh, and later the Notion import
  repos/      reference sources, gitignored (see below)
```

The split follows Alchemy Domain's recommended project layout:

- **`domain`** imports only `@alchemy.run/domain` and `effect`. It knows nothing about Cloudflare, so its stories run the whole model in memory, without a cloud account.
- **`server`** decides where the model runs and implements what the model depends on, such as storage and sign-in.
- **`web`** is a client of the same Api as the LLM.

Inside `domain`, there is one folder per part of the household (today `Babysitting/`) and one file per building block, named after its noun and its kind: `LogShift.command.ts`, `Sitter.aggregate.ts`, `Payouts.view.ts`. A command shares its file with the events it records and the rejections only it returns.

## Toolchain

| Tool | Version source | Notes |
|---|---|---|
| Node 24 | `devEngines` in `package.json`, `.nvmrc` | pnpm downloads the right Node by itself, so scripts run on Node 24 even if the machine has another version. |
| pnpm 12 | `packageManager` in `package.json` | Install it with Corepack (`npm install -g corepack@latest` first: the Corepack bundled with Node 24.11 cannot install pnpm 12) or, in CI, with `pnpm/action-setup`. |
| Dependencies | `catalog:` in `pnpm-workspace.yaml` | Every package refers to the catalog, so one line changes a version everywhere. |
| TypeScript 7 | catalog | `tsconfig.base.json` is strict, with `noUncheckedIndexedAccess`. |
| vitest + `@effect/vitest` | catalog | Stories are written with `it.effect`. |
| oxlint, oxfmt | catalog | Same formatting as the Alchemy repository, so code copied from there needs no reformatting. |

Common commands:

```sh
pnpm check        # typecheck, lint, format check, tests
pnpm test
pnpm dev          # the local server, in memory
pnpm fos --help   # the CLI
pnpm format
pnpm docs:dev     # this site, on localhost
pnpm repos:sync   # refresh repos/ after bumping a version
```

## Reference sources in `repos/`

Alchemy, Domain, Effect v4 and Foldkit are recent, and an LLM's memory of their APIs is unreliable. So the repository keeps their source next to ours:

| Folder | Repository | Checked out at |
|---|---|---|
| `repos/alchemy` | alchemy-run/alchemy | `v<alchemy version>` |
| `repos/effect` | Effect-TS/effect | `effect@<effect version>` |
| `repos/foldkit` | foldkit/foldkit | `foldkit@<foldkit version>` |

`scripts/sync-repos.sh` reads the versions from the catalog and shallow-clones each repository at the matching tag. A repository already at the right tag is skipped. `repos/` is gitignored: it is a cache, not part of our code, and nothing may import from it.

The most useful places to look:

- `repos/alchemy/website/src/content/docs/domain/`: the Domain manual and tutorial.
- `repos/alchemy/examples/cloudflare-domain/`: a full Domain app on Cloudflare with a Foldkit front end.
- `repos/alchemy/examples/cloudflare-domain-better-auth/`: Domain with better-auth sign-in.
- `repos/effect/packages/effect/src/`: Effect itself.
- `repos/foldkit/examples/`: small Foldkit apps.

## Agent skills

Skills give a coding agent the conventions of a library. Two sources feed `.claude/skills/`:

- **`alchemy-domain`** ships inside the `@alchemy.run/domain` npm package. pnpm 12 links skills from installed packages once they are allowed in `pnpm-workspace.yaml` (`permissions: { "@alchemy.run/domain": { skills: true } }`). The skill always matches the installed version.
- **`foldkit`, `generate-program`, `audit-program`** live in the Foldkit repository, not in its npm package. `sync-repos.sh` links them from `repos/foldkit/skills`, where they find the Foldkit source they expect.

All the links are gitignored and recreated on install and sync.

## Cloud sessions

Claude Code cloud sessions start from a fresh clone. The SessionStart hook in `.claude/hooks/session-start.sh` runs `pnpm install` and `sync-repos.sh`, but only when something they depend on has changed since the last successful run, so a resumed session starts immediately.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request: install, typecheck, lint, format check, tests, and a build of this site.
