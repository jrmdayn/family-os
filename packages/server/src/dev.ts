import { createServer } from "node:http";
/**
 * A local server for development: the whole model in memory, behind the same
 * routes as the Worker (/rpc, /api, /mcp), on http://localhost:8787. State is
 * lost when it stops.
 *
 *   pnpm dev                     # start it
 *   pnpm fos --help              # talk to it
 *
 * FAMILY_OS_TOKEN sets the bearer token (default "dev-token"). To try
 * Google sign-in locally, set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and
 * FAMILY_OS_OWNERS (your email); http://localhost:8787/api/auth/callback/google
 * must be a redirect URI of the Google client. Users and sessions are kept
 * in memory too.
 */
import { Memory } from "@alchemy.run/better-auth";
import * as Domain from "@alchemy.run/domain";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import { Auth, makeAuth } from "./Auth.ts";
import { OwnersFromConfig } from "./Owners.ts";
import { Routes } from "./Routes.ts";
import { OwnerTokenFromConfig, SessionLive } from "./Session.ts";

/** better-auth in memory, with Google when its client is configured. */
const AuthDev = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const clientId = yield* Config.option(Config.String("GOOGLE_CLIENT_ID"));
    const clientSecret = yield* Config.option(Config.Redacted("GOOGLE_CLIENT_SECRET"));
    return yield* makeAuth({
      origin: "http://localhost:8787",
      google:
        Option.isSome(clientId) && Option.isSome(clientSecret)
          ? { clientId: clientId.value, clientSecret: clientSecret.value }
          : undefined,
      secret: Redacted.make("family-os-dev-server-secret-not-for-production"),
    });
  }),
).pipe(Layer.provide(Memory()));

const World = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provideMerge(AuthDev),
  Layer.provideMerge(OwnersFromConfig({ fallback: [] })),
  Layer.provide(OwnerTokenFromConfig({ fallback: "dev-token" })),
);

const Server = HttpRouter.serve(Routes.pipe(Layer.provide(World)), {
  disableLogger: true,
  disableListenLog: true,
}).pipe(
  Layer.provideMerge(
    Layer.effectDiscard(
      Console.log(
        "Family OS dev server on http://localhost:8787 (in memory): /rpc, /api, /api/openapi.json, /mcp, /sign-in. Try: pnpm fos --help",
      ),
    ),
  ),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 8787 })),
  // The engine logs every view rebuild at Info; keep the terminal for what matters.
  Layer.provide(Layer.succeed(References.MinimumLogLevel, "Warn")),
);

NodeRuntime.runMain(Layer.launch(Server));
