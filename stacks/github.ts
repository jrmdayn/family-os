/**
 * Deploy credentials, provisioned as code. Deploy it from a laptop, with an
 * `admin` Alchemy profile that may create Cloudflare API tokens:
 *
 *   pnpm stacks:github           # create or update the tokens and secrets
 *   pnpm stacks:github:reveal    # the same, then print what to paste into Claude
 *
 * It creates two Cloudflare API tokens, each scoped to what deploying Family
 * OS needs:
 *
 * - `CIToken`, written with the account id into the repository's GitHub
 *   Actions secrets. Its value never passes through a terminal.
 * - `ClaudeSessionToken`, for Claude Code cloud sessions. Claude's settings
 *   can't be written from code, so `stacks:github:reveal` prints it once to
 *   copy into the cloud environment. Normal runs never print it.
 *
 * Two tokens, so either can be revoked without breaking the other. Re-run to
 * change their permissions; rename a token's id to rotate it.
 *
 * The first run also creates Alchemy's state store on the account (a Worker
 * with a Durable Object), which every later deploy, local or CI, shares.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const repository = { owner: "jrmdayn", repository: "family-os" } as const;

/** What deploying Family OS needs, on the whole account and nothing else. */
const deployPolicy = (accountId: string): Array<Cloudflare.ApiToken.Policy> => [
  {
    effect: "allow",
    permissionGroups: [
      // Workers and their Durable Objects, where the domain runs.
      "Workers Scripts Write",
      // The sign-in database (M3).
      "D1 Write",
      // Alchemy's state store keeps its token and encryption key here.
      "Secrets Store Write",
      // The workers.dev subdomain and account-level Worker settings.
      "Account Settings Write",
      // Live logs of deployed Workers.
      "Workers Tail Read",
    ],
    resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
  },
];

export default Alchemy.Stack(
  "FamilyOsGitHub",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;

    const ciToken = yield* Cloudflare.ApiToken.AccountApiToken("CIToken", {
      accountId,
      policies: deployPolicy(accountId),
    });

    yield* GitHub.Secret("CloudflareApiToken", {
      ...repository,
      name: "CLOUDFLARE_API_TOKEN",
      value: ciToken.value,
    });

    yield* GitHub.Secret("CloudflareAccountId", {
      ...repository,
      name: "CLOUDFLARE_ACCOUNT_ID",
      value: Redacted.make(accountId),
    });

    const sessionToken = yield* Cloudflare.ApiToken.AccountApiToken("ClaudeSessionToken", {
      accountId,
      policies: deployPolicy(accountId),
    });

    // Printed only on request: the stack's outputs are shown after a deploy.
    const reveal = yield* Config.Boolean("REVEAL_SESSION_TOKEN").pipe(Config.withDefault(false));
    if (!reveal) return {};
    return {
      "Paste into the Claude cloud environment": {
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: sessionToken.value.pipe(Output.map(Redacted.value)),
      },
    };
  }),
);
