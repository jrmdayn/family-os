---
title: Deploying
description: How Family OS reaches Cloudflare. One Alchemy stack, deployed by CI on every push to main.
---

Everything that runs on Cloudflare is declared in one Alchemy stack, `alchemy.run.ts` at the repository root (`FamilyOs`). Today it holds this docs site. The server Worker joins it in M2.

## The docs site

The site is Astro + Starlight with every page prerendered, so it deploys as an assets-only Worker: no Worker code runs, and Cloudflare's asset layer serves each request.

```ts
// alchemy.run.ts
const Docs = Cloudflare.Website.StaticSite("Docs", {
  name: "family-os-docs", // prod only; other stages get a generated name
  cwd: "docs",
  command: "pnpm run build",
  outdir: "dist",
  assets: { notFoundHandling: "404-page" },
});
```

`StaticSite` runs the build, hashes `docs/dist` and uploads it. The build only re-runs when a file under `docs/` or the lockfile changes, so a push that doesn't touch the docs deploys nothing. The prod stage serves at <https://family-os-docs.jrmdayn.workers.dev>.

## CI deploys main

`.github/workflows/ci.yml` has two jobs:

- **`check`** runs on every push and pull request: typecheck, lint, format, tests, docs build.
- **`deploy`** runs after `check` passes, only on pushes to `main`, and runs `pnpm deploy:prod --yes` with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets (see [Deploy credentials](/building/deploy-credentials/)).

Deploys from `main` are never cancelled halfway: a newer push waits for the running deploy instead of interrupting it, so Alchemy's state is never left mid-apply. State lives in the account's state store, shared by CI, laptops and Claude Code cloud sessions.

## Deploying by hand

With the Cloudflare credentials in the environment (or an Alchemy profile):

```sh
pnpm exec alchemy plan --stage prod   # what would change
pnpm deploy:prod                      # deploy it
```

Use another stage name to try a change without touching prod, then remove it with `pnpm exec alchemy destroy --stage <name>`.

In a Claude Code cloud session, Node only goes through the session's network proxy when `NODE_USE_ENV_PROXY=1` is set. Without it, Alchemy fails with a "Transport error". Set it in the cloud environment's variables, or prefix the command with it.
