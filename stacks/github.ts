/**
 * CI credentials, provisioned as code. Deploy it once from a laptop, with an
 * `admin` Alchemy profile that may create Cloudflare API tokens:
 *
 *   pnpm stacks:github
 *
 * It creates a Cloudflare API token scoped to what deploying Family OS needs,
 * and writes it, with the account id, into the repository's GitHub Actions
 * secrets. The token's value never passes through a terminal or the GitHub UI.
 * Re-run it to rotate the token or change its permissions.
 *
 * The first run also creates Alchemy's state store on the account (a Worker
 * with a Durable Object), which every later deploy, local or CI, shares.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const repository = { owner: "jrmdayn", repository: "family-os" } as const;

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
      policies: [
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
      ],
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
  }),
);
