import { createHash, randomBytes } from "node:crypto";
import { Memory } from "@alchemy.run/better-auth";
import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import { owner } from "@family-os/domain/Actor";
import { HOME } from "@family-os/domain/Babysitting/Household";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { RuntimeContext } from "alchemy";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { OAuth2Server } from "oauth2-mock-server";
import { Auth, makeAuth } from "../src/Auth.ts";
import { Owners, ownersOf } from "../src/Owners.ts";
import { Routes } from "../src/Routes.ts";
import { OwnerToken, SessionLive } from "../src/Session.ts";

/**
 * Claude.ai's sign-in, end to end, against the routes the Worker serves:
 * discovery, client registration, Google sign-in, consent, the token, then
 * `/mcp` with that token. A local OpenID Connect provider stands in for
 * Google, registered under the id `google`, so the sign-in page's request is
 * exactly the one it sends in production.
 */
const ORIGIN = "http://localhost";
const OWNER = "owner@example.com";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

let signingInAs = { sub: "google-owner", name: "Owner", email: OWNER };

const Google = Effect.acquireRelease(
  Effect.promise(async () => {
    const server = new OAuth2Server();
    await server.issuer.keys.generate("RS256");
    server.service.on("beforeTokenSigning", (token) =>
      Object.assign(token.payload, signingInAs, { email_verified: true }),
    );
    server.service.on("beforeUserinfo", (userinfo) => {
      userinfo.body = { ...signingInAs, email_verified: true };
    });
    await server.start(0, "127.0.0.1");
    return server;
  }),
  (server) => Effect.promise(() => server.stop()),
);

const AuthTest = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const google = yield* Google;
    return yield* makeAuth({
      origin: ORIGIN,
      google: undefined,
      secret: Redacted.make("a-test-secret-a-test-secret-a-test-secret"),
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: "google",
              discoveryUrl: `${google.issuer.url}/.well-known/openid-configuration`,
              clientId: "family-os",
              clientSecret: "family-os-secret",
              pkce: true,
            },
          ],
        }),
      ],
    });
  }).pipe(Effect.provide(RuntimeContext.phantom)),
).pipe(Layer.provide(Memory()));

const World = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provideMerge(AuthTest),
  Layer.provideMerge(Layer.succeed(Owners, ownersOf([OWNER]))),
  Layer.provide(
    Layer.succeed(OwnerToken, {
      token: Redacted.make("an-owner-token-that-is-long-enough!!"),
      actor: owner("bearer-token"),
    }),
  ),
);

/** A browser: the Worker's routes in process, and cookies kept between requests. */
const browser = Effect.gen(function* () {
  const { handler, dispose } = HttpRouter.toWebHandler(Routes.pipe(Layer.provide(World)), {
    disableLogger: true,
  });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const jar = new Map<string, string>();
  const keep = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...value] = pair!.split("=");
      jar.set(name!, value.join("="));
    }
    return response;
  };
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  const fetch = (path: string, init: RequestInit & { readonly anonymous?: boolean } = {}) =>
    Effect.promise(() => {
      const headers = new Headers(init.headers);
      if (!init.anonymous && jar.size > 0) headers.set("cookie", cookie());
      return handler(new Request(new URL(path, ORIGIN), { ...init, headers })).then(keep);
    });
  const json = <A = any>(response: Response) => Effect.promise(() => response.json() as Promise<A>);
  const post = (path: string, body: object) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    });
  return { fetch, json, post, clearCookies: () => jar.clear() };
});

/** What the sign-in and consent pages send back: the signed query the OAuth server gave them. */
const signedQueryOf = (location: string) => new URL(location, ORIGIN).search.slice(1);

/** Google, as a browser goes through it: sign in, and follow the redirect back to the app. */
const throughGoogle = (url: string) =>
  Effect.promise(() => globalThis.fetch(url, { redirect: "manual" })).pipe(
    Effect.map((response) => {
      const back = new URL(response.headers.get("location")!);
      return `${back.pathname}${back.search}`;
    }),
  );

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** One sessionless MCP request, as Claude sends it. */
const mcpCall = (name: string, args: object) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/call",
    "mcp-name": name,
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "claude-ai", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
      name,
      arguments: args,
    },
  }),
});

it.live("Claude.ai signs in as the owner, then calls the MCP tools with its token", () =>
  Effect.gen(function* () {
    signingInAs = { sub: "google-owner", name: "Owner", email: OWNER };
    const { fetch, json, post } = yield* browser;

    // 1. /mcp refuses, and says where to find out how to sign in.
    const refused = yield* fetch("/mcp", mcpCall("OwnerApi_Payouts_get", { key: HOME }));
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
    );

    // 2. Discovery: the resource names its authorization server, which lists its endpoints.
    const resource = yield* json(yield* fetch("/.well-known/oauth-protected-resource/mcp"));
    expect(resource).toMatchObject({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN] });
    const server = yield* json(yield* fetch("/.well-known/oauth-authorization-server"));
    expect(server).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/auth/oauth2/authorize`,
      token_endpoint: `${ORIGIN}/api/auth/oauth2/token`,
      registration_endpoint: `${ORIGIN}/api/auth/oauth2/register`,
      code_challenge_methods_supported: ["S256"],
    });

    // 3. Claude registers itself as a public client.
    const registered = yield* fetch(server.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: [CLAUDE_CALLBACK],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      anonymous: true,
    });
    expect(registered.status).toBe(201);
    const { client_id } = yield* json(registered);

    // 4. Claude sends the browser to authorize; nobody is signed in, so on to /sign-in.
    const { verifier, challenge } = pkce();
    const authorize = new URL(server.authorization_endpoint);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: CLAUDE_CALLBACK,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "claude-state",
      scope: "openid email profile offline_access",
      resource: `${ORIGIN}/mcp`,
    }).toString();
    const toSignIn = yield* fetch(authorize.toString(), {
      headers: { "sec-fetch-mode": "navigate" },
    });
    expect(toSignIn.status).toBe(302);
    const signInLocation = toSignIn.headers.get("location")!;
    expect(new URL(signInLocation, ORIGIN).pathname).toBe("/sign-in");

    // 5. The sign-in page starts a Google sign-in, carrying the signed query.
    const started = yield* post("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "/",
      oauth_query: signedQueryOf(signInLocation),
    });
    expect(started.status).toBe(200);
    const callback = yield* throughGoogle((yield* json(started)).url);

    // 6. Back from Google: signed in, and on to the consent page.
    const toConsent = yield* fetch(callback, { headers: { "sec-fetch-mode": "navigate" } });
    expect(toConsent.status).toBe(302);
    const consentLocation = toConsent.headers.get("location")!;
    expect(new URL(consentLocation, ORIGIN).pathname).toBe("/consent");

    // 7. The owner allows Claude; the browser goes back to Claude with a code.
    const consented = yield* post("/api/auth/oauth2/consent", {
      accept: true,
      oauth_query: signedQueryOf(consentLocation),
    });
    expect(consented.status).toBe(200);
    const backToClaude = new URL((yield* json(consented)).url);
    expect(`${backToClaude.origin}${backToClaude.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(backToClaude.searchParams.get("state")).toBe("claude-state");
    const code = backToClaude.searchParams.get("code")!;

    // 8. Claude exchanges the code for an access token, issued for /mcp.
    const tokens = yield* json(
      yield* fetch(server.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: CLAUDE_CALLBACK,
          client_id,
          code_verifier: verifier,
          resource: `${ORIGIN}/mcp`,
        }).toString(),
        anonymous: true,
      }),
    );
    expect(tokens).toMatchObject({ token_type: "Bearer" });
    expect(typeof tokens.refresh_token).toBe("string");

    // 9. With it, the tools answer, as the owner.
    const call = yield* fetch("/mcp", {
      ...mcpCall("OwnerApi_SetHourlyRate_send", {
        target: HOME,
        input: { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
      }),
      headers: {
        ...mcpCall("", {}).headers,
        "mcp-name": "OwnerApi_SetHourlyRate_send",
        authorization: `Bearer ${tokens.access_token}`,
      },
      anonymous: true,
    });
    expect(call.status).toBe(200);
    const result = (yield* json(call)).result;
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      reply: { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
    });

    // The browser that signed in is signed in too: its cookie works on /api.
    const viaCookie = yield* fetch(`/api/HourlyRates/${HOME}`);
    expect(viaCookie.status).toBe(200);
  }).pipe(Effect.provide(RuntimeContext.phantom), Effect.scoped),
);

it.live("someone who is not an owner can't sign in", () =>
  Effect.gen(function* () {
    signingInAs = { sub: "google-stranger", name: "Stranger", email: "stranger@example.com" };
    const { fetch, json, post } = yield* browser;

    const started = yield* post("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/sign-in",
    });
    const callback = yield* throughGoogle((yield* json(started)).url);
    const back = yield* fetch(callback, { headers: { "sec-fetch-mode": "navigate" } });
    expect(back.status).toBe(302);
    const location = new URL(back.headers.get("location")!, ORIGIN);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("error")).toBe("unable_to_create_user");

    // No session: the Api refuses.
    const refused = yield* fetch(`/api/HourlyRates/${HOME}`);
    expect(refused.status).toBe(401);
  }).pipe(Effect.provide(RuntimeContext.phantom), Effect.scoped),
);

it.live("a forged or foreign bearer token is refused on /mcp and /api", () =>
  Effect.gen(function* () {
    const { fetch } = yield* browser;
    for (const token of [
      "not-a-jwt",
      "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6Im93bmVyQGV4YW1wbGUuY29tIn0.",
    ]) {
      const mcp = yield* fetch("/mcp", {
        ...mcpCall("OwnerApi_Payouts_get", { key: HOME }),
        headers: { ...mcpCall("", {}).headers, authorization: `Bearer ${token}` },
        anonymous: true,
      });
      expect(mcp.status).toBe(401);
      const api = yield* fetch(`/api/HourlyRates/${HOME}`, {
        headers: { authorization: `Bearer ${token}` },
        anonymous: true,
      });
      expect(api.status).toBe(401);
    }
  }).pipe(Effect.provide(RuntimeContext.phantom), Effect.scoped),
);

it.live("the sign-in pages are served, with a strict content security policy", () =>
  Effect.gen(function* () {
    const { fetch } = yield* browser;
    for (const path of ["/", "/sign-in", "/consent"]) {
      const page = yield* fetch(path);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("content-security-policy")).toContain("default-src 'none'");
    }
  }).pipe(Effect.provide(RuntimeContext.phantom), Effect.scoped),
);
