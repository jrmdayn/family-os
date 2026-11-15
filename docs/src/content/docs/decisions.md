---
title: Decisions
description: The choices behind Family OS, with the reason for each.
---

Each entry records a choice, why it was made, and what would make us revisit it. Newest first.

## No Household aggregate

**Decision.** There is no `Household` aggregate and no household id on anything. One deployment serves one household.

**Why.** An aggregate exists to protect a rule when two writes could race. A household with one member protects no rule, and carrying a household id everywhere would only add noise. A second adult is one more email on the sign-in allowlist, not a change to the model.

**Revisit if** one deployment ever has to serve several families.

## One `RateCard` aggregate for the hourly rate

**Decision.** The hourly rate lives in a single-instance `RateCard` aggregate. `SetHourlyRate` takes an amount and the date it applies from.

**Why.** Every sitter is paid the same rate, revised about once a year. That rate is shared state with a rule of its own: effective dates only move forward, so exactly one rate applies on any day. A rule that needs protecting is what makes something an aggregate, even with one instance.

## Each shift records its rate and amount

**Decision.** `ShiftLogged` carries the rate in force on the shift's day and the amount it comes to.

**Why.** Revising the rate never changes what past shifts cost, statements need no rate history to display, and the Notion import can replay history with the rates that applied at the time.

**Revisit if** the rate is ever raised retroactively. That would be recorded as explicit corrections, not by rewriting history.

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
