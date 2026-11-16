---
title: Decisions
description: The choices behind Family OS, with the reason for each.
---

Each entry records a choice, why it was made, and what would make us revisit it. Newest first.

## Clients on older MCP revisions are bridged, without sessions

**Decision.** `/mcp` still runs only the sessionless `2026-07-28` server. A signed-in request that doesn't say `MCP-Protocol-Version: 2026-07-28` goes through `packages/server/src/McpLegacy.ts`: it answers `initialize` (with the capabilities and instructions the real server reports, and no `Mcp-Session-Id`) and `ping` itself, accepts notifications with `202`, answers batches, and rewrites every other request into its `2026-07-28` form for the real server. GET answers `405`.

**Why.** Gemini signed in to `dev` and then failed: it speaks a 2025 revision, which starts with `initialize`, and the server answered `400`. Effect implements those revisions only with sessions held by a long-lived server, which a Worker can't keep between requests; hosting them in a Durable Object per session would be far more machinery. Streamable HTTP lets a server issue no session id, and nothing Family OS offers needs one (no subscriptions, no server-initiated requests), so each request can stand alone. The `2026-07-28` results carry a few extra fields (`resultType`, `ttlMs`) that older clients ignore.

**Revisit if** a client needs something only a session gives (server-to-client requests, subscriptions), or Effect's request-scoped server learns the older revisions itself.

## Claude.ai signs in through our own OAuth server, with better-auth's `oauth-provider`

**Decision.** The server Worker is the OAuth authorization server for its own `/mcp`, with `@better-auth/oauth-provider` on the same better-auth that signs the owner in with Google. Claude.ai discovers it from the `401` on `/mcp` (protected resource metadata, RFC 9728), registers itself (open dynamic client registration), and sends the owner through `/sign-in`, Google and `/consent`. Access tokens are JWTs signed with the server's own key, whose audience is the `/mcp` URL and which carry the owner's email; the `Session` middleware checks them in process, with no database call but the signing keys. The owner token stays as a third way in. See [Signing in](/building/signing-in/).

**Why.** Claude.ai's custom connectors only sign in with OAuth, and MCP clients expect discovery and dynamic registration. better-auth already holds the users and sessions, so its OAuth plugin issues tokens for the same accounts, with the same allowlist, from the same D1 database; `@cloudflare/workers-oauth-provider` would have meant a second store (KV) and gluing Google sign-in into its authorize step by hand. A token bound to `/mcp` can't be replayed against another server, and the email inside it is checked against `FAMILY_OS_OWNERS` on every call, so removing an owner locks their tokens out at once. Open registration costs nothing: a registered client can do nothing until an owner signs in and consents.

**Trade-offs.** Registrations are rate limited only per Worker isolate, in memory. The issuer is the Worker's workers.dev origin, so moving to a custom domain will ask Claude to sign in again.

**Revisit if** Claude.ai moves to Client ID Metadata Documents instead of registration (better-auth has a `cimd` plugin), or a second resource server needs these tokens.

## Who may sign in is a secret list of emails, checked on every call

**Decision.** `FAMILY_OS_OWNERS` lists the owners' Google emails. better-auth refuses to create a user whose email isn't on it or isn't verified by Google, and the `Session` middleware checks the email of every OAuth token and session cookie against it. It is a GitHub Actions secret, bound to the Worker like the owner token, and a deploy without an email fails.

**Why.** The repository is public, so the list can't be code. Checking at sign-up keeps strangers out of the database; checking on every call means a removed owner loses access at the next deploy, without hunting down their sessions and tokens. One deployment is one household, so a second adult is one more email.

**Revisit if** the household needs roles (someone who can log shifts but not record payments): then owners become a model concept.

## The Worker learns its own URL from a binding

**Decision.** The server Worker reads its public origin from Alchemy's `Cloudflare.Worker.URL` binding when it starts, and builds better-auth with it: the OAuth issuer, the `/mcp` resource and Google's callback URL all derive from it. At deploy, before the URL exists, better-auth gets a placeholder; it only needs its schema then.

**Why.** OAuth needs absolute URLs fixed when better-auth starts, and they differ per stage: a preview's Worker name is generated. A binding that Alchemy fills at deploy keeps one code path for every stage, with no per-stage configuration to keep in sync.

**Revisit if** the Worker moves to a custom domain: the binding follows it, but the Google client's redirect URIs and Claude's connector URL must be updated by hand.

## A household view reads `null` until its first event, and its description says so

**Decision.** On a new household, `SitterDirectory` and `Payouts` read as `null` until the first sitter is registered, and `HourlyRates` until the first `SetHourlyRate` (over MCP, `{"value": null}`). We leave that as it is, and each of the three views' descriptions tells the LLM what `null` means: no sitters yet, nothing to wire, no household rate yet. The same change made `RegisterSitter`, `UpdateSitter` and `ArchiveSitter` reply with what they recorded, as every other command already did.

**Why.** Alchemy Domain has no initial state for reads: a view's `initial` is only the state its first event is applied to, and `get` of a key no event has reached returns nothing (`View.Host.get`, "`none` if it does not exist"; the view docs say "`null` if nothing has happened to that key yet"). Making the server or the Api turn `null` into an empty state would make `/api`, `/rpc` and `/mcp` disagree with the model and with its stories, for a case that lasts until the first command. A sentence in the description is what the LLM reads anyway, and it keeps one meaning per `null`: for `SitterBalance`, `null` still means there is no such sitter.

**Revisit if** Alchemy Domain gets a way for `get` to return a view's initial state, or a client other than an LLM reads these views and trips on `null`.

## A long-lived `dev` stage, deployed on demand

**Decision.** Besides `prod` and the `pr-<number>` previews, the stack has a `dev` stage that lives on, with its own data. Nothing deploys it on push: CI's `deploy-dev` job, started by hand from the Actions tab (`workflow_dispatch`), deploys any branch to it after the checks, and `pnpm deploy:dev` does the same from a laptop. Its server Worker is named `family-os-dev`, so its URL is stable (`https://family-os-dev.jrmdayn.workers.dev`) like prod's. It shares the Cloudflare account, the state store and the owner token with the other stages. See [Deploying](/building/deploying/#stages).

**Why.** A preview's data disappears when its pull request closes, and prod holds the real ledger. Trying a change against real Durable Objects, and pointing Claude Code at a deployed `/mcp` while building (M2's "done when"), needs a place whose data survives between deploys and whose URL doesn't change, so Claude's MCP configuration is set once. Deploying it on demand rather than on every push to a branch means any branch can be tried there without a merge, and what is being tried on `dev` stays there until someone deploys something else on purpose.

**Revisit if** several people need `dev` at the same time (then per-person stages, or deploy `dev` from a branch), or `dev` starts holding data that must not share prod's account and token.

## One Worker serves `/rpc`, `/api` and `/mcp` from the same Api

**Decision.** The server Worker serves the `OwnerApi` three ways, from `packages/server/src/Routes.ts`: `/rpc` (the Api's own protocol, for `fos` and later the web app), `/api` (plain HTTP and JSON with an OpenAPI document, from Domain's `toHttpApi`) and `/mcp` (MCP tools, from Domain's `toMcp`). All three publish the same list of calls, `ownerCalls` in `OwnerApi.api.ts`, and the local dev server serves the same routes. `/mcp` serves MCP `2026-07-28`, the sessionless revision, through `McpServer.layerHttpRequestScoped`, and bridges older revisions (see the entry above). See [Deploying](/building/deploying/#the-server-worker).

**Why.** Every call goes through the Api's handlers, so the session middleware, the rules and the rejections are the same whichever way a call comes in, and adding a command to `ownerCalls` publishes it everywhere at once. The dev server runs the same routes, so what works locally works on the Worker. A Worker can't keep an MCP session alive between requests, so it can only serve the sessionless revision. Claude Code connects to it; we checked with `claude mcp add` against both the dev server and a deployed stage.

**Revisit if** Claude.ai's connectors don't accept `2026-07-28` (the last check of M3; the fallback, `2025-11-25`, needs MCP sessions kept between requests), or a client outside our own needs a stable HTTP contract: `toHttpApi` publishes the domain's replies as they are, so that client would get an API of its own.

## The owner token is minted as code, one for every stage

**Decision.** `stacks/github.ts` makes the owner's bearer token with `Alchemy.Random("OwnerToken")` and writes it to the GitHub secret `FAMILY_OS_TOKEN`. CI passes it to every deploy, prod and previews alike, and the Worker binds it as a secret. `pnpm stacks:github:reveal` prints it for Claude. The Worker refuses a token shorter than 32 characters, so a deploy without the secret fails instead of accepting an empty bearer.

**Why.** It is the same pattern as the CI token: nobody types or copies the secret into GitHub, and rotating it is a rename. One token for every stage means Claude needs one value to reach prod or any preview. Previews already share prod's Cloudflare account, so per-stage tokens would add little.

**Revisit if** previews ever hold real data, or more than one person needs access before M3: then give each stage its own `Alchemy.Random` and keep prod's token out of previews.

## The model's Durable Objects live in the EU

**Decision.** The Worker hosts the model with `DomainCloudflare.layerDurableObjects({ jurisdiction: "eu" })`, so every Durable Object (sitters, rate card, views, policies) is created and stored only in Cloudflare's EU jurisdiction.

**Why.** Sitters' names and IBANs are personal data of people in France, and the household is in Paris, so EU storage costs nothing in latency. It has to be decided before the first deploy holds data: a Durable Object inside a jurisdiction is a different object from the one with the same name outside it, so adding a jurisdiction later would start the model empty.

**Trade-offs.** `alchemy dev` doesn't emulate jurisdictions, which doesn't matter here: local development runs the model in memory.

## One `Sitter` aggregate per babysitter, and the rate copied to each

**Decision.** Each sitter is its own `Sitter` aggregate, keyed by their id: their details, their own rate schedule, their balance, shifts and payments. The household rate lives in a `RateCard` aggregate (id `home`). `SetHourlyRate` changes it, and two policies copy it into the sitters' schedules: `HourlyRateRollout` sends each new rate to every active sitter, and `HourlyRateOnboarding` sends the whole schedule to a sitter when they register. `SetSitterRate` changes one sitter's rate. Names and nicknames are no longer unique; `SitterDirectory` lists the ones several active sitters share. This replaces the single `Ledger` aggregate below. See [The babysitting model](/building/babysitting-model/).

**Why.** Every rule about money is about one sitter (a balance, a payment that can't exceed it, archiving at zero), so a sitter is the natural consistency boundary. The household-wide ledger held state no decision needed together. Pricing still happens in `LogShift`, from the sitter's own copy of the rates, so the reply still carries the amount. Unique names were the other rule spanning sitters; keeping it would have needed a claim aggregate per name and an asynchronous registration. Its only purpose was an unambiguous lookup, and the directory now handles that by flagging shared names. A sitter with their own rate also becomes possible.

**Trade-offs.** The household rate reaches the sitters through policies, a moment after `SetHourlyRate` replies. If a sitter registers at the very moment the rate changes, the directory the rollout reads may not list them yet and they can miss that rate; `SitterBalance` shows each sitter's rates, and `SetSitterRate` fixes one. A household rate also doesn't override a sitter's own rate that starts on or after the same date.

**Revisit if** sitters miss rate changes in practice, or the household rate must be enforced rather than copied.

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

**Update (M3).** Google sign-in and OAuth came in beside the token rather than replacing it: `fos`, scripts and Claude Code have no browser to sign in with, and the token is already minted as code. The domain didn't change.

## The domain's units are cents, minutes and Paris dates

**Decision.** Money is integer euro cents, durations integer minutes, dates `YYYY-MM-DD` in Europe/Paris. Nothing is recorded after today in Paris (`DateInFuture`), and a payment can't exceed what is owed (`MoreThanOwed`).

**Why.** Integers avoid rounding drift. An LLM turns "4h on Friday" into these units easily, and the future-date check catches the most likely misreading ("Friday" as next Friday). Overpaying is almost always a typo; an advance can be added as its own command if it is ever needed.

## Repeated cancels and empty corrections are refused, not ignored

**Decision.** Cancelling a cancelled shift or payment, and a correction that changes nothing, are rejections (`ShiftAlreadyCancelled`, `PaymentAlreadyCancelled`, `NothingToCorrect`), not empty successes.

**Why.** Domain's convention allows an empty decision when the state already matches. Here every command replies with what it did, and an empty success would have nothing true to reply. A rejection tells the caller, often an LLM, exactly what happened. A retry of the same call is still safe: Domain replays the first result for a repeated command id.

## Shift and payment ids are readable

**Decision.** A shift's id, within its sitter, is its date (`2026-11-13`, then `-2`, `-3` for more that day); a payment's is `paid-<date>`. A sitter's id is a slug of their name, chosen when they are registered. (Under the single `Ledger`, shift ids carried the sitter too: `maria-2026-11-13`.)

**Why.** Decisions must be deterministic, so ids can't be random. Readable ids also let a person or an LLM refer to "Maria's shift on the 13th" without a lookup table.

## One `Ledger` aggregate holds the rate and the sitters

*Superseded by "One `Sitter` aggregate per babysitter" above.*

**Decision.** The whole babysitting ledger is one aggregate with the constant id `home`: the rate schedule, the sitters and their balances, and every shift and payment. This replaces the earlier plan of a `RateCard` aggregate plus one `Sitter` aggregate per babysitter.

**Why.** A decision may read only its own aggregate's state and what middleware provides. Pricing a shift needs the rate of its day, so with separate aggregates `LogShift` could not price the shift when it records it. Unique names and nicknames across sitters is a second rule that spans all sitters. One aggregate covers both, and a household's volume (a few shifts a week, a few thousand over years) is far below what one aggregate handles.

**Revisit if** the ledger's state grows large enough to slow decisions, or several households share a deployment.

## No Household aggregate

**Decision.** There is no `Household` aggregate and no household id on anything. One deployment serves one household.

**Why.** Tenancy protects no rule here: one deployment is one household, and carrying a household id everywhere would only add noise. (The rate card is a single-instance aggregate for a different reason: there is one household rate.) A second adult is one more email on the sign-in allowlist, not a change to the model.

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
