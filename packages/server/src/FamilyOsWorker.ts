/**
 * The Family OS server on Cloudflare: the model on Durable Objects (one per
 * sitter, per view key and per policy), behind the routes in `Routes.ts`,
 * with sign-in (better-auth) keeping its tables in D1.
 *
 * Read while the Worker builds, so Alchemy binds them as secrets at deploy
 * and the Worker reads them back at runtime (a deploy without them fails):
 *
 *   FAMILY_OS_TOKEN        the owner's bearer token
 *   FAMILY_OS_OWNERS       the emails that may sign in with Google
 *   GOOGLE_CLIENT_ID       the Google OAuth client
 *   GOOGLE_CLIENT_SECRET
 *
 * The Worker learns its own public URL from a `Worker.URL` binding: OAuth
 * needs it for the issuer and for the `/mcp` resource its tokens are for.
 */
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { RuntimeContext } from "alchemy";
import { Stack } from "alchemy/Stack";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import { Auth, makeAuth } from "./Auth.ts";
import { OwnersFromConfig } from "./Owners.ts";
import { Routes } from "./Routes.ts";
import { OwnerTokenFromConfig, SessionLive } from "./Session.ts";

/** better-auth's users, sessions, OAuth clients and signing keys. Emails are personal data: EU. */
export const AuthDb = Cloudflare.D1.Database("AuthDb", { jurisdiction: "eu" });

/**
 * better-auth on D1, signing in with Google. At deploy the Worker has no URL
 * yet, and better-auth only needs its schema then (Alchemy migrates D1).
 */
const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const selfUrl = yield* Cloudflare.Worker.URL;
    const origin = yield* selfUrl.pipe(Effect.provide(RuntimeContext.phantom));
    return yield* makeAuth({
      origin: origin ?? "https://family-os.invalid",
      google: {
        clientId: yield* Config.String("GOOGLE_CLIENT_ID"),
        clientSecret: yield* Config.Redacted("GOOGLE_CLIENT_SECRET"),
      },
    });
  }),
).pipe(Layer.provide(CloudflareD1(AuthDb)));

/**
 * The Session middleware and the model, hosted on Durable Objects. Swap
 * `DomainCloudflare.layerDurableObjects()` for `Domain.InMemory` and nothing
 * else changes: that is what `dev.ts` and the Api tests do.
 */
const FamilyOsLive = SessionLive.pipe(
  Layer.provideMerge(
    FamilyOs.layer(FamilyOsHandlers).pipe(
      // Sitters' names and IBANs are personal data: keep them in the EU.
      Layer.provide(DomainCloudflare.layerDurableObjects({ jurisdiction: "eu" })),
    ),
  ),
  Layer.provideMerge(AuthLive),
  Layer.provideMerge(OwnersFromConfig()),
  Layer.provide(OwnerTokenFromConfig()),
);

/**
 * The Worker's name, and so its workers.dev URL: stable for the long-lived
 * stages, `prod` and `dev`. Other stages (`pr-<number>`, by hand) get a
 * generated name.
 */
const workerName = (stage: string): string | undefined =>
  stage === "prod" ? "family-os" : stage === "dev" ? "family-os-dev" : undefined;

export default class FamilyOsWorker extends Cloudflare.Worker<FamilyOsWorker>()(
  "FamilyOsWorker",
  Effect.gen(function* () {
    const { stage } = yield* Stack;
    return {
      main: import.meta.url,
      name: workerName(stage),
      // better-auth keeps the OAuth flow's state in AsyncLocalStorage.
      compatibility: { flags: ["nodejs_compat"] },
    } satisfies Cloudflare.WorkerProps;
  }),
  Effect.gen(function* () {
    return { fetch: yield* HttpRouter.toHttpEffect(Routes) };
  }).pipe(Effect.provide(FamilyOsLive)),
) {}
