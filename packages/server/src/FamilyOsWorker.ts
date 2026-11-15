/**
 * The Family OS server on Cloudflare: the model on Durable Objects (one per
 * sitter, per view key and per policy), behind the routes in `Routes.ts`.
 *
 * The owner's bearer token is `FAMILY_OS_TOKEN`, read while the Worker builds:
 * Alchemy binds it as a secret at deploy, and the Worker reads it back from
 * that binding at runtime. A deploy without it fails.
 */
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as DomainCloudflare from "@alchemy.run/domain/Cloudflare";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { Stack } from "alchemy/Stack";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import { Routes } from "./Routes.ts";
import { OwnerTokenFromConfig, SessionLive } from "./Session.ts";

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
    return { main: import.meta.url, name: workerName(stage) } satisfies Cloudflare.WorkerProps;
  }),
  Effect.gen(function* () {
    return { fetch: yield* HttpRouter.toHttpEffect(Routes) };
  }).pipe(Effect.provide(FamilyOsLive)),
) {}
