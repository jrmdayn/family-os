/**
 * Everything Family OS serves over HTTP, the same on the Worker and on the
 * local dev server:
 *
 *   /rpc                the OwnerApi's own protocol, for typed clients (`fos`, the web app)
 *   /api/...            the same calls as plain HTTP and JSON
 *   /api/openapi.json   their OpenAPI document
 *   /mcp                the same calls as MCP tools, for Claude
 *
 * Every route goes through the OwnerApi's handlers, so the Session middleware
 * checks the bearer token on each call, whichever door it came through.
 */
import * as DomainAi from "@alchemy.run/domain/Ai";
import * as DomainHttp from "@alchemy.run/domain/Http";
import { OwnerApi, ownerCalls } from "@family-os/domain/OwnerApi.api";
import * as McpProtocol from "effect/ai/McpProtocol";
import * as McpServer from "effect/ai/McpServer";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as OpenApi from "effect/http-api/OpenApi";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

/** The OwnerApi as plain HTTP endpoints, one per call in `ownerCalls`. */
const OwnerHttp = DomainHttp.toHttpApi(OwnerApi, { expose: ownerCalls });

/** The plain HTTP Api, under `/api`. */
export class FamilyOsHttpApi extends HttpApi.make("FamilyOs")
  .add(OwnerHttp.group.prefix("/api"))
  .annotateMerge(
    OpenApi.annotations({
      title: "Family OS",
      version: "0.0.0",
      description: `${OwnerApi.annotations.description} Every call needs the owner's token: Authorization: Bearer <token>.`,
    }),
  ) {}

const PlainHttp = HttpApiBuilder.layer(FamilyOsHttpApi, { openapiPath: "/api/openapi.json" }).pipe(
  Layer.provide(OwnerHttp.layerFor(FamilyOsHttpApi)),
  // Nothing here serves files, so the file system is a no-op (Workers have none).
  Layer.provide([HttpPlatform.layer, Etag.layer, Path.layer]),
  Layer.provide(FileSystem.layerNoop({})),
);

/**
 * The MCP tools. Request-scoped and sessionless (`2026-07-28`), as a Worker
 * requires: each POST runs its own server and leaves nothing behind.
 */
const Mcp = DomainAi.toMcp(OwnerApi, { expose: ownerCalls }).pipe(
  Layer.provide(
    McpServer.layerHttpRequestScoped({
      name: "family-os",
      version: "0.0.0",
      path: "/mcp",
      protocols: [McpProtocol.v2026_07_28],
      instructions: OwnerApi.annotations.description,
    }),
  ),
  // It fails only when given a sessionful protocol, which the types above rule out.
  Layer.orDie,
);

/** The typed client's protocol: commands and reads over HTTP, live reads over WebSockets. */
const Rpc = HttpRouter.use((router) =>
  Effect.flatMap(OwnerApi, (api) => router.add("*", "/rpc", api.fetch)),
);

/** Every route. Needs the hosted model and the Session middleware's Layer. */
export const Routes = Layer.mergeAll(Rpc, PlainHttp, Mcp);
