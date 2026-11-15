/**
 * Sign-in: better-auth with Google, and the OAuth server a Claude connector
 * signs in through.
 *
 * - The owner signs in with Google. Only the emails in {@link Owners} get an
 *   account: anyone else is turned away before a user row is written.
 * - Claude.ai registers itself as an OAuth client (dynamic client
 *   registration), sends the owner here to sign in and consent, and gets an
 *   access token: a JWT this server signs, valid only for `/mcp` (its
 *   audience), carrying the owner's email.
 *
 * better-auth's tables (users, sessions, OAuth clients, signing keys) live
 * in D1 on Cloudflare and in memory on the dev server and in tests.
 */
import { BetterAuth, type BetterAuthApiError } from "@alchemy.run/better-auth";
import type { Database } from "@alchemy.run/better-auth/Database";
import { metadataResponse, oauthProvider } from "@better-auth/oauth-provider";
import type { RuntimeContext } from "alchemy";
import type { HttpEffect } from "alchemy/Http";
import type { BetterAuthPlugin } from "better-auth";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { jwt } from "better-auth/plugins/jwt";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { Owners } from "./Owners.ts";

/** Where everything sign-in related lives, from the server's public origin. */
export const authUrls = (origin: string) => ({
  origin,
  /** better-auth's routes. */
  basePath: "/api/auth" as const,
  /** The MCP server: the one resource access tokens are issued for. */
  mcp: `${origin}/mcp`,
  /** Its protected resource metadata (RFC 9728), which tells Claude where to sign in. */
  resourceMetadata: `${origin}/.well-known/oauth-protected-resource/mcp`,
});
export type AuthUrls = ReturnType<typeof authUrls>;

/** The scopes a client may ask for. The token's audience, not a scope, grants `/mcp`. */
export const scopes = ["openid", "profile", "email", "offline_access"];

export class Auth extends Context.Service<
  Auth,
  {
    readonly urls: AuthUrls;
    /** better-auth's routes, under `/api/auth`. */
    readonly fetch: HttpEffect<RuntimeContext>;
    /** The email behind a signed-in browser's session cookie, if any. */
    readonly sessionEmail: (headers: Headers) => Effect.Effect<Option.Option<string>>;
    /** The email in an access token issued for `/mcp`, if the token is valid. */
    readonly accessTokenEmail: (token: string) => Effect.Effect<Option.Option<string>>;
    /** `/.well-known/oauth-authorization-server` (RFC 8414). */
    readonly authorizationServerMetadata: HttpEffect<RuntimeContext>;
    /** `/.well-known/openid-configuration`. */
    readonly openIdConfiguration: HttpEffect<RuntimeContext>;
    /** `/.well-known/oauth-protected-resource` (RFC 9728) for `/mcp`. */
    readonly protectedResourceMetadata: HttpEffect;
  }
>()("FamilyOs/Auth") {}

export interface MakeAuthOptions {
  /** The server's public origin, as browsers and Claude reach it. */
  readonly origin: string;
  /** The Google OAuth client. Without it, nobody can sign in with Google. */
  readonly google:
    | { readonly clientId: string; readonly clientSecret: Redacted.Redacted }
    | undefined;
  /** Signs cookies and encrypts the signing keys. Defaults to a secret Alchemy generates and keeps. */
  readonly secret?: Redacted.Redacted;
  /** More better-auth plugins: tests add a local OpenID provider. */
  readonly plugins?: ReadonlyArray<BetterAuthPlugin>;
}

/** better-auth and its OAuth server, configured for Family OS. Needs a better-auth Database. */
export const makeAuth = (options: MakeAuthOptions) =>
  Effect.gen(function* () {
    const owners = yield* Owners;
    const urls = authUrls(options.origin);

    const instance = yield* BetterAuth({
      appName: "Family OS",
      basePath: urls.basePath,
      baseURL: urls.origin,
      ...(options.secret === undefined ? {} : { secret: options.secret }),
      socialProviders:
        options.google === undefined
          ? {}
          : {
              google: {
                clientId: options.google.clientId,
                clientSecret: Redacted.value(options.google.clientSecret),
                prompt: "select_account",
              },
            },
      // The JWT plugin's own /token hands a session's JWT to the browser;
      // only the OAuth token endpoint should issue tokens.
      disabledPaths: ["/token"],
      // On by default only where NODE_ENV is "production", which a Worker doesn't set.
      // In memory, so per isolate: enough to slow down open client registration.
      rateLimit: { enabled: true },
      databaseHooks: {
        user: {
          create: {
            // Only an owner, with an email Google verified, gets an account.
            before: async (user) => user.emailVerified === true && owners.includes(user.email),
          },
        },
      },
      plugins: [
        jwt({ disableSettingJwtHeader: true, jwt: { issuer: urls.origin } }),
        oauthProvider({
          loginPage: "/sign-in",
          consentPage: "/consent",
          scopes,
          // Claude.ai registers itself the first time it connects.
          allowDynamicClientRegistration: true,
          allowUnauthenticatedClientRegistration: true,
          resources: [urls.mcp],
          clientRegistrationDefaultResources: [urls.mcp],
          // The Session middleware reads who is calling from the token itself.
          customAccessTokenClaims: ({ user }) => (user ? { email: user.email } : {}),
        }),
        ...(options.plugins ?? []),
      ],
    });

    /** Runs a better-auth call in its own scope: it opens one instance per execution. */
    const run = <A>(effect: Effect.Effect<A, BetterAuthApiError, RuntimeContext>) =>
      Effect.scoped(effect) as Effect.Effect<A, BetterAuthApiError>;

    const sessionEmail = (headers: Headers) =>
      run(instance.api.getSession({ headers })).pipe(
        Effect.map((session) => Option.fromNullishOr(session?.user.email)),
        Effect.orElseSucceed(() => Option.none<string>()),
      );

    const accessTokenEmail = (token: string) =>
      run(instance.api.getJwks({})).pipe(
        Effect.flatMap((jwks) =>
          Effect.tryPromise(() =>
            verifyJwsAccessToken(token, {
              jwksFetch: async () => jwks,
              verifyOptions: { issuer: urls.origin, audience: urls.mcp },
            }),
          ),
        ),
        Effect.map((payload) =>
          typeof payload["email"] === "string" ? Option.some(payload["email"]) : Option.none(),
        ),
        Effect.orElseSucceed(() => Option.none<string>()),
      );

    /** A well-known document better-auth computes, served with its own headers. */
    const metadata = (
      load: (headers: Headers) => Effect.Effect<unknown, BetterAuthApiError, RuntimeContext>,
    ) =>
      Effect.scoped(load(new Headers())).pipe(
        Effect.map((body) => HttpServerResponse.fromWeb(metadataResponse(body))),
        Effect.orDie,
      );

    return Auth.of({
      urls,
      fetch: Effect.scoped(instance.fetch),
      sessionEmail,
      accessTokenEmail,
      authorizationServerMetadata: metadata((headers) =>
        instance.api.getOAuthServerConfig({ headers }),
      ),
      openIdConfiguration: metadata((headers) => instance.api.getOpenIdConfig({ headers })),
      protectedResourceMetadata: Effect.succeed(
        HttpServerResponse.fromWeb(
          metadataResponse({
            resource: urls.mcp,
            authorization_servers: [urls.origin],
            scopes_supported: scopes,
            bearer_methods_supported: ["header"],
            resource_name: "Family OS",
          }),
        ),
      ),
    });
  }) as Effect.Effect<Auth["Service"], never, Database | Owners>;
