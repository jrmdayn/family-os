---
title: Decisions
description: The choices behind Family OS, with the reason for each.
---

Each entry records a choice, why it was made, and what would make us revisit it. Newest first.

## Every pull request gets a preview stage

**Decision.** CI deploys each pull request from this repository to its own stage, `pr-<number>`, comments the URLs on the pull request, and destroys the stage when the pull request closes. Previews use the same Cloudflare account and CI token as prod. See [Deploying](/building/deploying/).

**Why.** A change can be tried on Cloudflare before it reaches `main`, and with the server in M2, Claude Code can be pointed at a preview's `/mcp`. Stages are Alchemy's unit of isolation, so a preview needs no extra configuration, and Workers on workers.dev cost nothing while idle. Revisit if previews need data that must not sit on the prod account; Alchemy's tutorial shows splitting them onto a second account.

## The docs deploy from main, as static assets in the app stack

**Decision.** `alchemy.run.ts` declares the docs as a `Cloudflare.Website.StaticSite` with no Worker code, and CI deploys its `prod` stage on every push to `main` that passes the checks. See [Deploying](/building/deploying/).

**Why.** The site is fully static, so an assets-only Worker serves it at no compute cost, with no extra dependency (`Cloudflare.Website.Astro` would need `@alchemy.run/frontend-frameworks` for nothing). Putting it in the app stack now means the server joins an existing stack and deploy job in M2. Deploys from `main` aren't cancelled by later pushes, so state is never left mid-apply. Revisit if the docs need server-rendered pages.

## CI credentials are provisioned as code

**Decision.** `stacks/github.ts` creates CI's Cloudflare API token and writes it into the repository's GitHub Actions secrets. It runs from the owner's laptop with an `admin` Alchemy profile. See [Deploy credentials](/building/deploy-credentials/).

**Why.** This is Alchemy's recommended setup. The CI token is scoped to deploying Family OS, its value never passes through a terminal or the GitHub UI, and rotating it is one command. The powerful credential, the one that can create tokens, stays on one laptop.

## A bearer token stands in for sign-in until M3

**Decision.** The server's `Session` middleware accepts one secret bearer token and signs it in as the owner. The dev server reads it from `FAMILY_OS_TOKEN`.

**Why.** Every command and read already declares the `Session` middleware, so the Api is guarded from day one. The token check is a few lines in `packages/server/src/Session.ts`; Google sign-in and OAuth replace it in M3 without touching the domain.

## The domain's units are cents, minutes and Paris dates

**Decision.** Money is integer euro cents, durations integer minutes, dates `YYYY-MM-DD` in Europe/Paris. Nothing is recorded after today in Paris (`DateInFuture`), and a payment can't exceed what is owed (`MoreThanOwed`).

**Why.** Integers avoid rounding drift. An LLM turns "4h on Friday" into these units easily, and the future-date check catches the most likely misreading ("Friday" as next Friday). Overpaying is almost always a typo; an advance can be added as its own command if it is ever needed.

## Repeated cancels and empty corrections are refused, not ignored

**Decision.** Cancelling a cancelled shift or payment, and a correction that changes nothing, are rejections (`ShiftAlreadyCancelled`, `PaymentAlreadyCancelled`, `NothingToCorrect`), not empty successes.

**Why.** Domain's convention allows an empty decision when the state already matches. Here every command replies with what it did, and an empty success would have nothing true to reply. A rejection tells the caller, often an LLM, exactly what happened. A retry of the same call is still safe: Domain replays the first result for a repeated command id.

## Shift and payment ids are readable

**Decision.** A shift's id is `<sitter>-<date>` (`maria-2026-11-13`, then `-2`, `-3` for more that day); a payment's is `<sitter>-paid-<date>`. A sitter's id is a slug of their name.

**Why.** Decisions must be deterministic, so ids can't be random. Readable ids also let a person or an LLM refer to "Maria's shift on the 13th" without a lookup table.

## One `Ledger` aggregate holds the rate and the sitters

**Decision.** The whole babysitting ledger is one aggregate with the constant id `home`: the rate schedule, the sitters and their balances, and every shift and payment. This replaces the earlier plan of a `RateCard` aggregate plus one `Sitter` aggregate per babysitter.

**Why.** A decision may read only its own aggregate's state and what middleware provides. Pricing a shift needs the rate of its day, so with separate aggregates `LogShift` could not price the shift when it records it. Unique names and nicknames across sitters is a second rule that spans all sitters. One aggregate covers both, and a household's volume (a few shifts a week, a few thousand over years) is far below what one aggregate handles.

**Revisit if** the ledger's state grows large enough to slow decisions, or several households share a deployment.

## No Household aggregate

**Decision.** There is no `Household` aggregate and no household id on anything. One deployment serves one household.

**Why.** Tenancy protects no rule here: one deployment is one household, and carrying a household id everywhere would only add noise. (The ledger is a single-instance aggregate for a different reason; see above.) A second adult is one more email on the sign-in allowlist, not a change to the model.

**Revisit if** one deployment ever has to serve several families.

## Each shift records its rate and amount

**Decision.** `ShiftLogged` carries the rate in force on the shift's day and the amount it comes to.

**Why.** Revising the rate never changes what past shifts cost, statements need no rate history to display, and the Notion import can replay history with the rates that applied at the time.

A rate set after a shift was logged reaches it only through `CorrectShift`, which re-prices the shift at the rate of its date. A retroactive raise is a set of explicit corrections, never a rewrite of history.

## Reference sources are cloned at our versions, not vendored

**Decision.** `scripts/sync-repos.sh` shallow-clones Alchemy, Effect and Foldkit into a gitignored `repos/`, at the tags matching the catalog.

**Why.** Agents need the real source of these young libraries. A git subtree (what Foldkit suggests) would add hundreds of megabytes of history to this repository. A shallow clone pinned by the catalog gives the same files at the same version.

## pnpm links agent skills, not skills-npm

**Decision.** Skills shipped in npm packages are linked by pnpm 12's built-in support, allowed per package in `pnpm-workspace.yaml`.

**Why.** Alchemy's docs suggest `skills-npm`, which links the same skills. pnpm 12 does it natively, and `skills-npm` is being folded into another CLI. One tool fewer.

## The docs site is public

**Decision.** The docs are deployed publicly and contain only made-up example data.

**Why.** They explain how the app is built, not what is in it. Being public keeps them simple to serve, with no sign-in in front.

## The CAFE stack

**Decision.** Cloudflare, Alchemy (with Alchemy Domain), Foldkit and Effect v4.

**Why.** Alchemy Domain models the business once and publishes it as HTTP, a CLI and MCP tools. Talking to Family OS through an LLM is the main way it is used, so MCP support without extra work is the deciding feature. Cloudflare's free plan covers a household's traffic.
