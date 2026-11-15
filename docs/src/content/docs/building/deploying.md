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

## CI deploys main, and a preview per pull request

`.github/workflows/ci.yml` has four jobs:

| Job | Runs on | Does |
|---|---|---|
| `check` | every push and pull request | typecheck, lint, format, tests, docs build |
| `deploy` | pushes to `main`, after `check` | `pnpm deploy:prod --yes` |
| `preview` | pull request opened, reopened or pushed to, after `check` | deploys the stage `pr-<number>` |
| `preview-cleanup` | pull request closed or merged | destroys the stage `pr-<number>` |

All of them use the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets (see [Deploy credentials](/building/deploy-credentials/)).

A preview is a full copy of the stack under its own stage, with generated Worker names. When CI sets `PULL_REQUEST`, `alchemy.run.ts` also declares a `GitHub.Comment` on the pull request listing the preview's URLs, using the workflow's own `GITHUB_TOKEN`. The comment keeps its logical id, so each push edits it in place, and it stays on the pull request after the preview is destroyed. Pull requests from forks get no preview, since they can't read the secrets.

Deploys and destroys are never cancelled halfway: a newer push waits for the running one instead of interrupting it, so Alchemy's state is never left mid-apply. Only `check` is cancelled when a newer push supersedes it. The `preview` job checks the pull request is still open before deploying, so a pull request closed while its checks ran doesn't leave a preview behind. State lives in the account's state store, shared by CI, laptops and Claude Code cloud sessions.

## Deploying by hand

With the Cloudflare credentials in the environment (or an Alchemy profile):

```sh
pnpm exec alchemy plan --stage prod   # what would change
pnpm deploy:prod                      # deploy it
```

Use another stage name to try a change without touching prod, then remove it with `pnpm exec alchemy destroy --stage <name>`.

In a Claude Code cloud session, Node only goes through the session's network proxy when `NODE_USE_ENV_PROXY=1` is set. Without it, Alchemy fails with a "Transport error". Set it in the cloud environment's variables, or prefix the command with it.
