/**
 * fos: every OwnerApi command and read as a subcommand.
 *
 *   pnpm fos --help
 *   pnpm fos log-shift --target maria --date 2026-11-13 --minutes 240
 *   pnpm fos payouts get --key home
 *
 * FAMILY_OS_URL is the Api's address (default http://localhost:8787, the dev
 * server) and FAMILY_OS_TOKEN its bearer token (default "dev-token").
 */
import * as Domain from "@alchemy.run/domain";
import { toCli } from "@alchemy.run/domain/Cli";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { OwnerApi, ownerCalls } from "@family-os/domain/OwnerApi.api";
import * as Command from "effect/cli/Command";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

const fos = toCli(OwnerApi, {
  name: "fos",
  expose: ownerCalls,
  headers: Config.Redacted("FAMILY_OS_TOKEN").pipe(
    Config.withDefault(Redacted.make("dev-token")),
    Effect.map((token) => ({ authorization: `Bearer ${Redacted.value(token)}` })),
  ),
});

const Protocol = Layer.unwrap(
  Effect.map(
    Config.String("FAMILY_OS_URL").pipe(Config.withDefault("http://localhost:8787")),
    // The Worker and the dev server serve the typed client's protocol at /rpc.
    (url) => Domain.protocolHttp(`${url.replace(/\/$/, "")}/rpc`),
  ),
).pipe(Layer.provide(FetchHttpClient.layer));

Command.run(fos, { version: "0.0.0" }).pipe(
  Effect.provide(Layer.mergeAll(Protocol, NodeServices.layer)),
  NodeRuntime.runMain,
);
