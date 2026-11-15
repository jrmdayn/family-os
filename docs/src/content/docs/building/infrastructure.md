---
title: Infrastructure
description: What runs on Cloudflare, how a request reaches a sitter's Durable Object, and where the stages, state and secrets live.
---

Everything Family OS runs is on one Cloudflare account: a server Worker that hosts the model on Durable Objects, and a static Worker that serves this site. Alchemy declares all of it in TypeScript. This page is the map; [Deploying](/building/deploying/) and [Deploy credentials](/building/deploy-credentials/) have the details.

## Two Alchemy stacks

| Stack | File | Declares | Deployed |
|---|---|---|---|
| `FamilyOs` | `alchemy.run.ts` | The server Worker and its Durable Objects, the docs site, and on previews the pull request comment | By CI and `pnpm deploy:*`, once per stage |
| `FamilyOsGitHub` | `stacks/github.ts` | The Cloudflare API tokens for CI and for Claude Code cloud sessions, the owner token, and the GitHub Actions secrets that hold them | By hand, from the owner's laptop, stage `prod` only |

The app stack never creates credentials, and the credentials stack never deploys the app. The second one needs an admin credential that can create API tokens, which CI never has. See [Deploy credentials](/building/deploy-credentials/).

## The server Worker

`packages/server/src/FamilyOsWorker.ts` is one Worker. It serves `/mcp`, `/api` and `/rpc` from `packages/server/src/Routes.ts` (see [Deploying](/building/deploying/#the-server-worker)), and builds the model with `DomainCloudflare.layerDurableObjects({ jurisdiction: "eu" })`.

Domain turns every aggregate, view and policy of the model into a Durable Object class on this Worker while it builds. Nothing in our code declares a class or a binding. The class names start with the model's name, `FamilyOs`. `alchemy plan --stage dev` lists them:

| Class | Kind | One object per |
|---|---|---|
| `FamilyOs.SitterAggregate` | Aggregate | Sitter id (`maria`): their book, events and state |
| `FamilyOs.RateCardAggregate` | Aggregate | Rate card; there is one, `home` |
| `FamilyOs.SitterDirectoryView` | View | Key; there is one, `home` |
| `FamilyOs.HourlyRatesView` | View | Key; there is one, `home` |
| `FamilyOs.SitterBalanceView` | View | Sitter id |
| `FamilyOs.SitterStatementView` | View | Sitter id |
| `FamilyOs.PayoutsView` | View | Key; there is one, `home` |
| `FamilyOs.HourlyRateRolloutPolicy` | Policy | Policy key (by default, the instance whose events it reacts to) |
| `FamilyOs.HourlyRateOnboardingPolicy` | Policy | Policy key, the same way |
| `FamilyOs.SitterDirectoryViewRun`, `HourlyRatesViewRun`, `SitterBalanceViewRun`, `SitterStatementViewRun`, `PayoutsViewRun` | Backfill run | Part of the run that fills that view with the history recorded before it existed |
| `FamilyOs.DomainDirectory` | Directory | Node of a tree that lists every instance, so a backfill can find them |

The plan also lists two resources that aren't classes:

- **`FamilyOs.DomainBackfill`**, a Cloudflare Workflow bound to the Worker. A deploy that adds a view, or bumps a view's version, uses it to start that view's run and wait for it.
- **`FamilyOs.DomainBackfillRun`**, the deploy step that starts the Workflow and waits until every new view has its history. A deploy that changes no view waits for nothing.

Policies have no run: they act on new events only, never on history. Domain's [Cloudflare](https://alchemy.run/domain/cloudflare/) and [History at scale](https://alchemy.run/domain/backfill/) pages explain the directory and backfill runs.

Domain guarantees what the model relies on: commands to one sitter run one at a time, and a command's events, new state and reply commit together. Every event reaches the views and policies that read it at least once, in order for each sitter, even if an object restarts in between.

### The data stays in the EU

Every one of these objects is created and stored in Cloudflare's EU jurisdiction, because sitters' names and IBANs are personal data. A Durable Object inside a jurisdiction is a different object from the one with the same name outside it, so the jurisdiction was set before the first deploy held data. See [Decisions](/decisions/).

## A request's path

"Maria 4h on Friday", sent by Claude to a deployed stage:

```text
Claude
  │  POST /mcp   tools/call OwnerApi_LogShift_send
  │  Authorization: Bearer <FAMILY_OS_TOKEN>
  ▼
Server Worker (family-os / family-os-dev)          packages/server/src/FamilyOsWorker.ts
  │  Routes.ts: /mcp runs a request-scoped MCP server (sessionless, 2026-07-28)
  ▼
Session middleware                                  packages/server/src/Session.ts
  │  checks the bearer token; a wrong one returns Unauthorized here
  ▼
OwnerApi handlers                                   packages/domain/src/OwnerApi.api.ts
  │  LogShift { target: "maria", input: { date, minutes } }
  ▼
Durable Object FamilyOs.SitterAggregate "maria"    (EU)
  │  decides from Maria's state and now: ShiftLogged, or a rejection
  │  commits the event, the new state and the reply together
  ├──► reply to the Worker ──► MCP result to Claude
  │
  └──► after the commit, the event is delivered to
         FamilyOs.SitterBalanceView "maria"
         FamilyOs.SitterStatementView "maria"
         FamilyOs.PayoutsView "home"
         (no policy reacts to ShiftLogged)
```

`/api` and `/rpc` take the same path from the Session middleware down. Reads (`Payouts`, `SitterBalance`, ...) go from the handlers to the view's object for that key. The views update a moment after the reply; a read can pass the reply's `stream` and `version` as `atLeast` to wait for its own write.

Registering a sitter takes one more hop: `SitterRegistered` reaches the `HourlyRateOnboarding` policy, which reads the rate card and sends `SetSitterRate` back to the new sitter's object.

## Stages

Each stage is a full copy of the app stack, with its own Workers and its own Durable Objects, so its own data.

| Stage | Server Worker | Docs | Lives |
|---|---|---|---|
| `prod` | `https://family-os.jrmdayn.workers.dev` | `https://family-os-docs.jrmdayn.workers.dev` | Always; deployed on every push to `main` |
| `dev` | `https://family-os-dev.jrmdayn.workers.dev` | generated name | Always; deployed on demand |
| `pr-<number>` | generated name, posted on the pull request | generated name | Until the pull request closes |

See [Deploying](/building/deploying/#stages) for who deploys each one, and the [walkthrough](/building/walkthrough/) to point Claude Code at `dev`.

## Alchemy's state

Both stacks use `Cloudflare.state()`: Alchemy keeps what it deployed in a state store on the same account, a Worker backed by a Durable Object with SQLite. Its own token and encryption key sit in the account's Secrets Store. The first run of `stacks/github.ts` created it. Every stage shares it, whether the deploy runs in CI, on a laptop or in a Claude Code cloud session.

## Secrets

| Secret | Where it lives | Read by |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` (CI token) | GitHub Actions secret | CI's deploy jobs |
| `CLOUDFLARE_API_TOKEN` (session token) | Claude Code cloud environment | Deploys and plans from cloud sessions |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret, Claude Code cloud environment | Every deploy |
| `FAMILY_OS_TOKEN` (owner token) | Alchemy state (`OwnerToken`), GitHub Actions secret, Claude Code cloud environment, and a secret binding on each stage's server Worker | Deploys bind it; the Session middleware checks it; Claude and `fos` send it |
| State store token and encryption key | The account's Secrets Store | Alchemy |
| Admin credential | The `admin` Alchemy profile on the owner's laptop | `pnpm stacks:github` only |
| `GITHUB_TOKEN` | Issued by GitHub to each workflow run | The preview comment |

How each is made and rotated is in [Deploy credentials](/building/deploy-credentials/).

## The docs site

This site is Astro + Starlight, prerendered, and deployed by the same app stack as an assets-only Worker: Cloudflare's asset layer serves every page and no code runs. See [Deploying](/building/deploying/#the-docs-site).

## Locally

`pnpm dev` runs none of this: the same routes and the same model, with `Domain.InMemory` in place of Durable Objects and `dev-token` as the token. See [Local development](/building/local-development/).
