import { createServer } from "node:http";
/**
 * A local server for development: the whole model in memory, behind the
 * OwnerApi over HTTP, on http://localhost:8787. State is lost when it stops.
 *
 *   pnpm dev                     # start it
 *   pnpm fos --help              # talk to it
 *
 * FAMILY_OS_TOKEN sets the bearer token (default "dev-token").
 */
import * as Domain from "@alchemy.run/domain";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { owner } from "@family-os/domain/Actor";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { OwnerApi } from "@family-os/domain/OwnerApi.api";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as HttpServer from "effect/http/HttpServer";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import { OwnerToken, SessionLive } from "./Session.ts";

const DevOwnerToken = Layer.effect(
  OwnerToken,
  Effect.gen(function* () {
    const token = yield* Config.Redacted("FAMILY_OS_TOKEN").pipe(
      Config.withDefault(Redacted.make("dev-token")),
    );
    return { token, actor: owner("dev@localhost") };
  }),
);

const Model = FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory));

const World = SessionLive.pipe(Layer.provideMerge(Model), Layer.provide(DevOwnerToken));

const Server = Layer.unwrap(Effect.map(OwnerApi, (api) => HttpServer.serve()(api.fetch))).pipe(
  Layer.provideMerge(
    Layer.effectDiscard(
      Console.log(
        "Family OS dev server on http://localhost:8787 (in memory). Try: pnpm fos --help",
      ),
    ),
  ),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  Layer.provide(World),
  // The engine logs every view rebuild at Info; keep the terminal for what matters.
  Layer.provide(Layer.succeed(References.MinimumLogLevel, "Warn")),
);

NodeRuntime.runMain(Layer.launch(Server));
