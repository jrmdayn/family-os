---
title: Deploy credentials
description: How CI gets a narrowly scoped Cloudflare token without anyone copying it, and how to rotate it.
---

GitHub Actions deploys Family OS with a Cloudflare API token. Nobody creates that token by hand: `stacks/github.ts` creates it and writes it into the repository's Actions secrets. This follows Alchemy's recommended CI setup.

## Two credentials

| Credential | Where it lives | Can | Used for |
|---|---|---|---|
| **Admin** | The `admin` Alchemy profile on the owner's laptop (`~/.alchemy/`) | Create API tokens (full account access) | Running `stacks/github.ts`, rarely |
| **CI token** | GitHub Actions secret `CLOUDFLARE_API_TOKEN` | Workers Scripts, D1, Secrets Store, Account Settings, Workers Tail | Every deploy from CI |

The admin credential never leaves the laptop and is never used for ordinary deploys. The CI token can deploy Family OS and nothing else: no DNS, no billing, no new tokens.

## What the stack does

`stacks/github.ts` is a small Alchemy stack (`FamilyOsGitHub`, stage `prod`):

- `Cloudflare.ApiToken.AccountApiToken("CIToken")` creates the CI token with the permission groups above. Cloudflare reveals a token's value once; Alchemy keeps it in its encrypted state.
- `GitHub.Secret` writes it to `CLOUDFLARE_API_TOKEN`, and the account id to `CLOUDFLARE_ACCOUNT_ID`.
- `state: Cloudflare.state()` keeps Alchemy's state in a Worker with a Durable Object on the account. The first run creates that state store; every later deploy, from a laptop or CI, shares it.

## Set it up (once)

On a laptop, from a clone of the repository:

```sh
pnpm install
pnpm exec alchemy profile create admin
pnpm exec alchemy profile edit --profile admin --add Cloudflare
pnpm exec alchemy profile edit --profile admin --add GitHub
pnpm stacks:github
```

- For Cloudflare, choose **API Key + Email** with the account's Global API Key (My Profile → API Tokens → Global API Key). OAuth can't create API tokens.
- For GitHub, choose the **`gh` CLI** (after `gh auth login`) or a personal access token with the `repo` scope.

`pnpm stacks:github` plans three creates (the token and two secrets), plus the state store on the first run, and asks before applying. Afterwards, the repository's **Settings → Secrets and variables → Actions** lists both secrets.

## Rotate or change it

Edit the permission groups in `stacks/github.ts`, then run `pnpm stacks:github` again: the token and the secret are updated. To rotate the token's value, rename its logical id (`CIToken` → `CIToken2`) and run it: Alchemy creates the new token, updates the secret, and deletes the old token.
