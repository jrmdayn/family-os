/**
 * The Family OS app stack. For now it holds the public docs site; the server
 * Worker joins it in M2.
 *
 *   pnpm deploy:prod    # what CI runs on every push to main
 *
 * Credentials come from CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (see
 * stacks/github.ts and the "Deploy credentials" docs page). State lives in the
 * account's Alchemy state store, shared with CI.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";

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
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const docs = yield* Docs;
    return { docs: docs.url };
  }),
);
