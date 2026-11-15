/**
 * The Family OS app stack. For now it holds the public docs site; the server
 * Worker joins it in M2.
 *
 *   pnpm deploy:prod    # what CI runs on every push to main
 *
 * CI also deploys one `pr-<number>` stage per pull request, comments its URL
 * on the pull request, and destroys the stage when the pull request closes.
 *
 * Credentials come from CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (see
 * stacks/github.ts and the "Deploy credentials" docs page), plus GITHUB_TOKEN
 * for the preview comment. State lives in the account's Alchemy state store,
 * shared with CI.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as GitHub from "@alchemy.run/github";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** The docs site: Astro + Starlight, fully static, served as Worker assets. */
const Docs = Cloudflare.Website.StaticSite(
  "Docs",
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    return {
      // A stable workers.dev URL in prod; other stages get a generated name.
      name: stage === "prod" ? "family-os-docs" : undefined,
      cwd: "docs",
      command: "pnpm run build",
      outdir: "dist",
      // No Worker code: Cloudflare's asset layer serves every request.
      assets: { notFoundHandling: "404-page" },
    } satisfies Cloudflare.Website.StaticSiteProps;
  }),
);

export default Alchemy.Stack(
  "FamilyOs",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const docs = yield* Docs;

    // Set by CI on pull request previews only.
    const pullRequest = yield* Config.Number("PULL_REQUEST").pipe(Config.withDefault(undefined));
    if (pullRequest !== undefined) {
      const commit = yield* Config.String("PREVIEW_SHA").pipe(Config.withDefault("unknown"));
      // Same logical id on every push, so the comment is edited in place.
      // It stays on the pull request when the preview is destroyed.
      yield* GitHub.Comment("PreviewComment", {
        owner: "jrmdayn",
        repository: "family-os",
        issueNumber: pullRequest,
        body: Output.interpolate`
          ### Preview

          | | |
          |---|---|
          | Docs | ${docs.url} |

          Built from ${commit.slice(0, 7)}. Updated on every push, removed when this pull request closes.
        `,
      });
    }

    return { docs: docs.url };
  }),
);
