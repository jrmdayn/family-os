/**
 * Who is calling. Three ways in, all resolving to an owner:
 *
 * - the owner's bearer token (`FAMILY_OS_TOKEN`), for `fos`, scripts and
 *   Claude Code: no browser needed;
 * - an access token Claude got through OAuth (see `Auth.ts`), for a Claude.ai
 *   connector on the web and on a phone;
 * - better-auth's session cookie, for a browser signed in with Google.
 *
 * The last two carry a Google email, accepted only while it is in
 * {@link Owners}: removing an email locks its tokens and sessions out at once.
 */
import { Actor, owner } from "@family-os/domain/Actor";
import { CurrentActor } from "@family-os/domain/CurrentActor.context";
import { Session, Unauthorized } from "@family-os/domain/Session.middleware";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Auth } from "./Auth.ts";
import { Owners } from "./Owners.ts";

/**
 * The bearer token that signs the owner in, and who it signs in as: one
 * secret token, kept out of logs and traces as a Redacted value.
 */
export class OwnerToken extends Context.Service<
  OwnerToken,
  { readonly token: Redacted.Redacted<string>; readonly actor: Actor }
>()("FamilyOs/OwnerToken") {}

/**
 * `FAMILY_OS_TOKEN`, at least 32 characters. An unset GitHub secret reaches
 * CI as an empty string, and an empty token would match an empty bearer: the
 * length check makes that deploy fail instead.
 */
const ownerTokenConfig = Config.schema(
  Schema.Redacted(Schema.String.check(Schema.isMinLength(32))),
  "FAMILY_OS_TOKEN",
);

/**
 * The owner's token, read from `FAMILY_OS_TOKEN`. On the Worker, reading it
 * while the Worker builds binds it as a secret at deploy, and reads it back
 * from that binding at runtime. `fallback` is for the dev server only.
 */
export const OwnerTokenFromConfig = (options: { readonly fallback?: string } = {}) =>
  Layer.effect(
    OwnerToken,
    Effect.gen(function* () {
      const config = ownerTokenConfig;
      const token = yield* options.fallback === undefined
        ? config
        : config.pipe(Config.withDefault(Redacted.make(options.fallback)));
      return { token, actor: owner("bearer-token") };
    }),
  );

/** Compares in time independent of where the strings differ, so timing leaks nothing. */
const sameSecret = (given: string, expected: string): boolean => {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};

const bearerOf = (headers: Headers.Headers): Option.Option<string> =>
  Option.flatMap(Headers.get(headers, "authorization"), (value) =>
    value.startsWith("Bearer ") ? Option.some(value.slice("Bearer ".length)) : Option.none(),
  );

/** Finds who made a request, from its headers. Used by the Session middleware and the `/mcp` guard. */
export class Authenticate extends Context.Service<
  Authenticate,
  { readonly actorOf: (headers: Headers.Headers) => Effect.Effect<Option.Option<Actor>> }
>()("FamilyOs/Authenticate") {}

/**
 * The owner's token always works. Google sign-in and OAuth tokens work when
 * the server runs better-auth ({@link Auth}, with {@link Owners}); tests of
 * the model alone leave both out.
 */
export const AuthenticateLive = Layer.effect(
  Authenticate,
  Effect.gen(function* () {
    const { token, actor: tokenActor } = yield* OwnerToken;
    const expected = Redacted.value(token);
    const auth = yield* Effect.serviceOption(Auth);
    const owners = yield* Effect.serviceOption(Owners);

    /** An email better-auth vouched for, as the owner, if it is still on the list. */
    const asOwner = (email: Option.Option<string>) =>
      Option.flatMap(email, (email) =>
        Option.isSome(owners) && owners.value.includes(email)
          ? Option.some(owner(email))
          : Option.none(),
      );

    const actorOf = (headers: Headers.Headers): Effect.Effect<Option.Option<Actor>> =>
      Effect.gen(function* () {
        const bearer = bearerOf(headers);
        if (Option.isSome(bearer) && sameSecret(bearer.value, expected)) {
          return Option.some(tokenActor);
        }
        if (Option.isNone(auth)) return Option.none();
        if (Option.isSome(bearer)) {
          return asOwner(yield* auth.value.accessTokenEmail(bearer.value));
        }
        if (Option.isNone(Headers.get(headers, "cookie"))) return Option.none();
        return asOwner(
          yield* auth.value.sessionEmail(new globalThis.Headers(Object.entries(headers))),
        );
      });

    return Authenticate.of({ actorOf });
  }),
);

/** The {@link Session} middleware: whoever {@link Authenticate} finds, or Unauthorized. */
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const { actorOf } = yield* Authenticate;
    return (effect, { headers }) =>
      Effect.flatMap(actorOf(headers), (actor) =>
        Option.match(actor, {
          onNone: () => Effect.fail(new Unauthorized()),
          onSome: (actor) => Effect.provideService(effect, CurrentActor, actor),
        }),
      );
  }),
).pipe(Layer.provideMerge(AuthenticateLive));
