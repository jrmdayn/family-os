---
title: Signing in
description: How the owner signs in with Google, how Claude.ai signs in as a custom connector through Family OS's own OAuth server, and how to connect Claude on the web and on a phone.
---

Family OS has one kind of user, the household's owner, and three ways to prove it. Each ends in the same `Session` middleware, which provides the owner as the `CurrentActor` of every command and read:

| Credential | Sent by | How it is checked |
|---|---|---|
| The owner token, `Authorization: Bearer <FAMILY_OS_TOKEN>` | `fos`, scripts, Claude Code | Compared with the token bound to the Worker |
| An OAuth access token, `Authorization: Bearer <JWT>` | A Claude.ai custom connector (web, desktop and mobile apps) | Signature checked with the server's own keys; its audience must be `/mcp`; its email must be an owner's |
| better-auth's session cookie | A browser signed in with Google | Looked up in better-auth's sessions; its email must be an owner's |

The code is in `packages/server/src/`: `Auth.ts` (better-auth and the OAuth server), `Session.ts` (`Authenticate` and the `Session` middleware), `Owners.ts` (the allowlist), `Pages.ts` (the sign-in and consent pages) and `Routes.ts` (where all of it is served).

## Google sign-in, for owners only

[better-auth](https://better-auth.com) signs the owner in with Google and keeps users, sessions and signing keys in a D1 database, `AuthDb`, created in Cloudflare's EU jurisdiction like the model's Durable Objects. Alchemy creates the tables at deploy, from better-auth's schema.

Only the emails in `FAMILY_OS_OWNERS` can sign in. better-auth asks before writing a new user, and `Auth.ts` answers no unless Google verified the email and it is on the list. Someone else who signs in with Google gets no account and lands back on `/sign-in` with "This Google account is not an owner of this household". The `Session` middleware checks the list again on every call, so removing an email from `FAMILY_OS_OWNERS` and redeploying locks that person out at once, tokens and cookies alike.

`FAMILY_OS_OWNERS` is a secret rather than code because the repository is public. A deploy without at least one email fails.

The Google OAuth client lives in a Google Cloud project. Its redirect URIs are each stage's `/api/auth/callback/google`:

```text
https://family-os.jrmdayn.workers.dev/api/auth/callback/google
https://family-os-dev.jrmdayn.workers.dev/api/auth/callback/google
http://localhost:8787/api/auth/callback/google
```

Preview stages get generated URLs, and Google accepts no wildcards, so Google sign-in doesn't work on previews. The owner token does.

## Claude signs in through Family OS's own OAuth server

A Claude.ai custom connector doesn't take a fixed token: it signs in with OAuth, following the [MCP authorization spec](https://modelcontextprotocol.io/specification/draft/basic/authorization). So the server Worker is also an OAuth authorization server, with better-auth's [`oauth-provider`](https://www.npmjs.com/package/@better-auth/oauth-provider) plugin:

- **Discovery.** `/mcp` answers `401` to a request without a valid credential, with `WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp"`. That document names the authorization server, the Worker itself, whose `/.well-known/oauth-authorization-server` lists its endpoints under `/api/auth/oauth2/`.
- **Registration.** Claude registers itself the first time it connects (dynamic client registration, `POST /api/auth/oauth2/register`), as a public client using PKCE. Registration is open, as MCP clients expect, and rate limited. A registered client can do nothing until the owner signs in and allows it.
- **Sign-in and consent.** The authorization endpoint sends the browser to `/sign-in`, then Google, then `/consent`, where the owner allows the client. These pages are plain HTML with a little script, served by the Worker (see `Pages.ts`).
- **The token.** Claude exchanges the code for an access token and a refresh token. The access token is a JWT signed with the server's own key (Ed25519, kept encrypted in D1), valid for an hour, whose audience is the `/mcp` URL and which carries the owner's email. Claude refreshes it with the refresh token, valid for 30 days of disuse, without asking again.

The server's issuer is its own origin (`https://family-os.jrmdayn.workers.dev` in prod). The Worker learns that origin from Alchemy's `Cloudflare.Worker.URL` binding, which Alchemy fills in at deploy.

```text
Claude.ai           Family OS Worker                                 Owner's browser     Google
   │                     │                                                 │                │
   │ POST /mcp ─────────►│ no token: 401                                   │                │
   │◄──── WWW-Authenticate: Bearer resource_metadata=".../oauth-protected-resource/mcp"     │
   │ GET /.well-known/oauth-protected-resource/mcp                         │                │
   │ GET /.well-known/oauth-authorization-server                           │                │
   │ POST /api/auth/oauth2/register ──► client_id                          │                │
   │                     │                                                 │                │
   │ open /api/auth/oauth2/authorize?client_id&code_challenge&resource=…/mcp ──────────────►│
   │                     │◄──────────────────────────── GET authorize ─────│                │
   │                     │ not signed in: 302 /sign-in?…&sig=… ──────────►│                │
   │                     │◄──── POST /api/auth/sign-in/social {google, oauth_query}         │
   │                     │ ─────────────────────────── 302 to Google ─────►│ sign in ──────►│
   │                     │◄──────────────── GET /api/auth/callback/google?code ◄────────────│
   │                     │ email is an owner's: session cookie,            │                │
   │                     │ 302 /consent?…&sig=… ──────────────────────────►│                │
   │                     │◄──── POST /api/auth/oauth2/consent {accept: true}                │
   │◄─────────────────── 302 https://claude.ai/api/mcp/auth_callback?code&state ────────────│
   │ POST /api/auth/oauth2/token {code, code_verifier, resource}           │                │
   │◄── access token (JWT, aud …/mcp, email), refresh token                │                │
   │                     │                                                 │                │
   │ POST /mcp, Authorization: Bearer <JWT> ──►│ Session: owner ──► tool runs              │
```

`packages/server/test/SignIn.test.ts` runs this whole exchange against the Worker's routes, with a local OpenID Connect provider standing in for Google.

## Connect Claude.ai (runbook)

Custom connectors are added on claude.ai, under your account, and the Claude desktop and mobile apps use the same list. Your Claude plan must allow custom connectors.

1. Open [claude.ai](https://claude.ai), then **Settings → Connectors → Add custom connector**.
2. Name it `Family OS`, and set the URL to the stage's `/mcp`: `https://family-os.jrmdayn.workers.dev/mcp` for prod, `https://family-os-dev.jrmdayn.workers.dev/mcp` to try `dev`. Leave the OAuth client fields empty: Claude registers itself.
3. Choose **Connect**. A window opens on Family OS's sign-in page. Sign in with Google as an owner, then **Allow** Claude.
4. Back in Claude, the connector lists Family OS's tools. In a chat, enable it from the tools menu and try "Maria 4h on Friday", then "What do I need to wire to whom?".
5. On a phone, open the Claude app signed in to the same account: the connector is already there. Enable it in a chat the same way.

To disconnect, remove the connector in Claude's settings. To revoke everything Claude holds, also remove the owner's email from `FAMILY_OS_OWNERS` and redeploy, or wait for its refresh token to expire.

If the sign-in window shows an error:

| Shows | Means |
|---|---|
| "This Google account is not an owner of this household" | The email isn't in `FAMILY_OS_OWNERS` for that stage |
| Google's `redirect_uri_mismatch` | The stage's callback URL isn't a redirect URI of the Google client (previews never are) |
| Claude says it can't connect after signing in | Check the connector's URL ends in `/mcp`, then the Worker's logs: `pnpm exec alchemy tail --stage <stage>` |

## MCP revisions

`/mcp` runs MCP `2026-07-28`, the revision without sessions, because a request-scoped Worker can't keep one open. Clients on a 2024–2025 revision (Gemini, many SDKs) open with an `initialize` handshake instead, which this server alone would refuse with a `400`. `McpLegacy.ts` bridges them without sessions, as Streamable HTTP allows: it answers `initialize` and `ping` itself, accepts notifications, and rewrites every other request into its `2026-07-28` form. GET (a server-to-client stream) answers `405`. See [Decisions](/decisions/).

## Locally

The dev server runs better-auth in memory at `http://localhost:8787`, with the same routes. Google sign-in works there when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `FAMILY_OS_OWNERS` are set; without them, the owner token (`dev-token`) still does everything. See [Local development](/building/local-development/).
