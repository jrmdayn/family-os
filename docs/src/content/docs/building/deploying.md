---
title: Deploying
description: How Family OS reaches Cloudflare. One Alchemy stack, deployed by CI on every push to main.
---

Everything that runs on Cloudflare is declared in one Alchemy stack, `alchemy.run.ts` at the repository root (`FamilyOs`): the server Worker and this docs site.

## The server Worker

`packages/server/src/FamilyOsWorker.ts` hosts the model on Durable Objects. Each sitter is one Durable Object, as are the rate card, each view key and each policy. Domain declares all of them while the Worker builds, so there are no classes or bindings to write. The Worker serves the routes in `packages/server/src/Routes.ts`, the same routes as the [local dev server](/building/local-development/):

| Route | For | What |
|---|---|---|
| `/mcp` | Claude | Every command and read as an MCP tool |
| `/api/...` | Scripts, `curl` | The same calls as plain HTTP and JSON |
| `/api/openapi.json` | Anyone generating a client | The OpenAPI document of `/api` |
| `/rpc` | `fos`, later the web app | The Api's own protocol, for typed Effect clients |

```ts
// packages/server/src/FamilyOsWorker.ts
const FamilyOsLive = SessionLive.pipe(
  Layer.provideMerge(
    FamilyOs.layer(FamilyOsHandlers).pipe(
      Layer.provide(DomainCloudflare.layerDurableObjects({ jurisdiction: "eu" })),
    ),
  ),
  Layer.provide(OwnerTokenFromConfig()),
);
```

The local dev server and the Api tests build the same thing with `Domain.InMemory` in place of `DomainCloudflare.layerDurableObjects(...)`. Only the hosting changes.

Every route goes through the `OwnerApi`'s handlers, so the `Session` middleware checks the bearer token on every call. Without a valid token, `/api` answers `401` and an MCP tool call returns an `Unauthorized` error. `tools/list` still lists the tools to anyone, since their descriptions are in this repository anyway.

**The token.** `OwnerTokenFromConfig` reads `FAMILY_OS_TOKEN` while the Worker builds. At deploy, Alchemy reads it from the environment and binds it to the Worker as a secret. At runtime, the Worker reads it back from that binding. `stacks/github.ts` makes the token and writes it to the repository's secrets (see [Deploy credentials](/building/deploy-credentials/)). A token shorter than 32 characters fails the deploy. That includes an empty one, which is what GitHub Actions passes when the secret doesn't exist.

**The data stays in the EU.** The Durable Objects are created in Cloudflare's EU jurisdiction: sitters' names and IBANs are personal data. See [Decisions](/decisions/).

**MCP over the sessionless protocol.** A Worker can't keep an MCP session open between requests, so `/mcp` serves MCP `2026-07-28`, the protocol revision without sessions: each request runs on its own and leaves nothing behind. Clients that only speak an older revision get an error. Claude Code speaks this revision.

The prod Worker is named `family-os`, so its URL is stable: `https://family-os.jrmdayn.workers.dev`. Other stages get generated names, listed in the stack's outputs and in the preview comment.

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
| `deploy` | pushes to `main`, after `check` | `pnpm deploy:prod --yes`: the server Worker and the docs |
| `preview` | pull request opened, reopened or pushed to, after `check` | deploys the stage `pr-<number>` |
| `preview-cleanup` | pull request closed or merged | destroys the stage `pr-<number>` |

All of them use the `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `FAMILY_OS_TOKEN` secrets (see [Deploy credentials](/building/deploy-credentials/)). Previews bind the same owner token as prod.

A preview is a full copy of the stack under its own stage, with generated Worker names. When CI sets `PULL_REQUEST`, `alchemy.run.ts` also declares a `GitHub.Comment` on the pull request listing the preview's URLs (its `/mcp`, its OpenAPI document and its docs), using the workflow's own `GITHUB_TOKEN`. The comment keeps its logical id, so each push edits it in place, and it stays on the pull request after the preview is destroyed. Pull requests from forks get no preview, since they can't read the secrets.

Deploys and destroys are never cancelled halfway: a newer push waits for the running one instead of interrupting it, so Alchemy's state is never left mid-apply. Only `check` is cancelled when a newer push supersedes it. The `preview` job checks the pull request is still open before deploying, so a pull request closed while its checks ran doesn't leave a preview behind. State lives in the account's state store, shared by CI, laptops and Claude Code cloud sessions.

## Deploying by hand

With the Cloudflare credentials and `FAMILY_OS_TOKEN` in the environment (or an Alchemy profile for Cloudflare):

```sh
pnpm exec alchemy plan --stage prod   # what would change
pnpm deploy:prod                      # deploy it
```

Use another stage name to try a change without touching prod, then remove it with `pnpm exec alchemy destroy --stage <name>`.

In a Claude Code cloud session, Node only goes through the session's network proxy when `NODE_USE_ENV_PROXY=1` is set. Without it, Alchemy fails with a "Transport error". Set it in the cloud environment's variables, or prefix the command with it.
