/**
 * Everything Family OS serves over HTTP, the same on the Worker and on the
 * local dev server:
 *
 *   /rpc                the OwnerApi's own protocol, for typed clients (`fos`, the web app)
 *   /api/...            the same calls as plain HTTP and JSON
 *   /api/openapi.json   their OpenAPI document
 *   /mcp                the same calls as MCP tools, for Claude
 *
 *
 * and, for signing in (see `Auth.ts` and `Pages.ts`):
 *
 *   /api/auth/...       better-auth: Google sign-in, and the OAuth server Claude.ai uses
 *   /.well-known/...    OAuth discovery: where to sign in, and for which resource
 *   /, /sign-in, /consent   the pages a browser signs in on
 *
 * Every call goes through the OwnerApi's handlers, so the Session middleware
 * checks who is calling, whichever door it came through. `/mcp` also answers
 * 401 up front, which is what starts Claude's OAuth sign-in.
 */
import * as DomainAi from "@alchemy.run/domain/Ai";
import * as DomainHttp from "@alchemy.run/domain/Http";
import { OwnerApi, ownerCalls } from "@family-os/domain/OwnerApi.api";
import { RuntimeContext } from "alchemy";
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
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { Auth } from "./Auth.ts";
import { bridgeLegacyMcp } from "./McpLegacy.ts";
import { consentPage, homePage, signInPage } from "./Pages.ts";
import { Authenticate } from "./Session.ts";

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

/**
 * Answers `/mcp` with a 401 before the MCP server runs, unless the request
 * is signed in. Signed-in requests from clients on an older MCP revision go
 * through `McpLegacy.ts`. The challenge points at the protected resource metadata,
 * which is how Claude finds where to sign in (MCP authorization, RFC 9728).
 */
const McpGuard = HttpRouter.middleware(
  Effect.gen(function* () {
    const { actorOf } = yield* Authenticate;
    const auth = yield* Effect.serviceOption(Auth);
    const challenge = Option.match(auth, {
      onNone: () => "Bearer",
      onSome: ({ urls }) => `Bearer resource_metadata="${urls.resourceMetadata}"`,
    });
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const actor = yield* actorOf(request.headers);
        // Signed in: clients on a 2024–2025 revision go through the bridge.
        if (Option.isSome(actor)) return yield* bridgeLegacyMcp(httpEffect);
        return HttpServerResponse.jsonUnsafe(
          { error: "invalid_token", error_description: "Sign in to Family OS first." },
          { status: 401, headers: { "www-authenticate": challenge } },
        );
      });
  }),
);

/** The typed client's protocol: commands and reads over HTTP, live reads over WebSockets. */
const Rpc = HttpRouter.use((router) =>
  Effect.flatMap(OwnerApi, (api) => router.add("*", "/rpc", api.fetch)),
);

/**
 * Sign-in: better-auth under `/api/auth`, the discovery documents an OAuth
 * client reads first, and the pages a browser signs in on. Only when the
 * server runs better-auth.
 */
const SignIn = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    // better-auth's effects declare the Worker's RuntimeContext; the runtime supplies it.
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.provide(effect, RuntimeContext.phantom);
    yield* router.add("*", `${auth.urls.basePath}/*`, provide(auth.fetch));
    // Clients look for the issuer's metadata at the root, and some under its path.
    for (const path of [
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-authorization-server/api/auth",
    ] as const) {
      yield* router.add("GET", path, provide(auth.authorizationServerMetadata));
    }
    for (const path of [
      "/.well-known/openid-configuration",
      "/.well-known/openid-configuration/api/auth",
      "/api/auth/.well-known/openid-configuration",
    ] as const) {
      yield* router.add("GET", path, provide(auth.openIdConfiguration));
    }
    for (const path of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ] as const) {
      yield* router.add("GET", path, auth.protectedResourceMetadata);
    }
    yield* router.add("GET", "/", homePage);
    yield* router.add("GET", "/sign-in", signInPage);
    yield* router.add("GET", "/consent", consentPage);
  }),
);

/**
 * Every route but sign-in. Needs the hosted model and the Session
 * middleware's Layer, which brings {@link Authenticate}.
 */
export const ModelRoutes = Layer.mergeAll(Rpc, PlainHttp, Mcp.pipe(Layer.provide(McpGuard.layer)));

/** Every route, sign-in included: what the Worker and the dev server serve. Needs {@link Auth} too. */
export const Routes = Layer.mergeAll(ModelRoutes, SignIn);
