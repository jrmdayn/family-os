import { createServer } from "node:http";
/**
 * A local server for development: the whole model in memory, behind the same
 * routes as the Worker (/rpc, /api, /mcp), on http://localhost:8787. State is
 * lost when it stops.
 *
 *   pnpm dev                     # start it
 *   pnpm fos --help              # talk to it
 *
 * FAMILY_OS_TOKEN sets the bearer token (default "dev-token").
 */
import * as Domain from "@alchemy.run/domain";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import * as Console from "effect/Console";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import { Routes } from "./Routes.ts";
import { OwnerTokenFromConfig, SessionLive } from "./Session.ts";

const World = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provide(OwnerTokenFromConfig({ fallback: "dev-token" })),
);

const Server = HttpRouter.serve(Routes.pipe(Layer.provide(World)), {
  disableLogger: true,
  disableListenLog: true,
}).pipe(
  Layer.provideMerge(
    Layer.effectDiscard(
      Console.log(
        "Family OS dev server on http://localhost:8787 (in memory): /rpc, /api, /api/openapi.json, /mcp. Try: pnpm fos --help",
      ),
    ),
  ),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  // The engine logs every view rebuild at Info; keep the terminal for what matters.
  Layer.provide(Layer.succeed(References.MinimumLogLevel, "Warn")),
);

NodeRuntime.runMain(Layer.launch(Server));
