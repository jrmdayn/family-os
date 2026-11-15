---
title: Deploying
description: How Family OS reaches Cloudflare. One Alchemy stack, deployed to prod on every push to main, to dev on demand, and to a preview per pull request.
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

The Worker's name, and so its URL, depends on the stage (see [Stages](#stages)): `family-os` in prod, `family-os-dev` in dev, a generated name anywhere else.

```ts
// packages/server/src/FamilyOsWorker.ts
const workerName = (stage: string): string | undefined =>
  stage === "prod" ? "family-os" : stage === "dev" ? "family-os-dev" : undefined;
```

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

## Stages

The stack is deployed under three kinds of stage. Each stage is a full copy of the stack with its own Workers and its own Durable Objects, so its own data.

| Stage | For | Deployed | Server Worker URL |
|---|---|---|---|
| `prod` | The household's real ledger | by CI, on every push to `main` that passes the checks | `https://family-os.jrmdayn.workers.dev` |
| `dev` | Trying a change on real Cloudflare before prod; the stage Claude Code is pointed at while building | on demand: CI's `deploy-dev` job, or `pnpm deploy:dev` | `https://family-os-dev.jrmdayn.workers.dev` |
| `pr-<number>` | Reviewing one pull request | by CI, on every push to the pull request; destroyed when it closes | generated, posted in the preview comment |

`dev` is long-lived: nothing deploys it on push, and nothing destroys it, so its data survives from one deploy to the next. Deploy any branch to it when you want to try that branch against real Durable Objects, then deploy another one later.

All stages share the Cloudflare account, the Alchemy state store and the owner token (`FAMILY_OS_TOKEN`), so one token reaches the `/mcp` of any of them. Only the docs site keeps a generated name outside prod: the public docs are prod's.

## CI deploys main, dev on demand, and a preview per pull request

`.github/workflows/ci.yml` has five jobs:

| Job | Runs on | Does |
|---|---|---|
| `check` | every push, pull request and manual run | typecheck, lint, format, tests, docs build |
| `deploy` | pushes to `main`, after `check` | `pnpm deploy:prod --yes`: the server Worker and the docs |
| `deploy-dev` | a manual run ("Run workflow" in the Actions tab, on any branch), after `check` | `pnpm deploy:dev --yes`: the chosen branch to the `dev` stage |
| `preview` | pull request opened, reopened or pushed to, after `check` | deploys the stage `pr-<number>` |
| `preview-cleanup` | pull request closed or merged | destroys the stage `pr-<number>` |

To deploy a branch to dev, open the CI workflow in the repository's Actions tab, choose "Run workflow" and pick the branch. GitHub only offers that button once the workflow, with its `workflow_dispatch` trigger, is on the default branch. `gh workflow run ci.yml --ref <branch>` does the same from a terminal.

All of them use the `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `FAMILY_OS_TOKEN` secrets (see [Deploy credentials](/building/deploy-credentials/)). Previews and dev bind the same owner token as prod.

A preview is a full copy of the stack under its own stage, with generated Worker names. When CI sets `PULL_REQUEST`, `alchemy.run.ts` also declares a `GitHub.Comment` on the pull request listing the preview's URLs (its `/mcp`, its OpenAPI document and its docs), using the workflow's own `GITHUB_TOKEN`. The comment keeps its logical id, so each push edits it in place, and it stays on the pull request after the preview is destroyed. Pull requests from forks get no preview, since they can't read the secrets.

Deploys and destroys are never cancelled halfway: a newer push waits for the running one instead of interrupting it, so Alchemy's state is never left mid-apply. Only `check` is cancelled when a newer push supersedes it. Its concurrency group includes the event, so a manual run on `main` never cancels the checks of a push to `main`. Two dev deploys queue the same way: the second waits for the first. The `preview` job checks the pull request is still open before deploying, so a pull request closed while its checks ran doesn't leave a preview behind. State lives in the account's state store, shared by CI, laptops and Claude Code cloud sessions.

## Deploying by hand

With the Cloudflare credentials and `FAMILY_OS_TOKEN` in the environment (or an Alchemy profile for Cloudflare):

```sh
pnpm exec alchemy plan --stage prod   # what would change
pnpm deploy:prod                      # deploy it
pnpm deploy:dev                       # deploy this checkout to dev
```

To try a change without touching prod, deploy it to `dev`. A throwaway stage works too: any other stage name gets generated Worker names; remove it with `pnpm exec alchemy destroy --stage <name>`. Never destroy `dev`: that deletes its data.

In a Claude Code cloud session, Node only goes through the session's network proxy when `NODE_USE_ENV_PROXY=1` is set. Without it, Alchemy fails with a "Transport error". Set it in the cloud environment's variables, or prefix the command with it.
