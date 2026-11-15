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

/**
 * The bearer token that signs the owner in, and who it signs in as. A
 * stand-in until sign-in with Google and OAuth (M3): one secret token, kept
 * out of logs and traces as a Redacted value.
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

/** The {@link Session} middleware: the owner's token signs them in; anything else is Unauthorized. */
export const SessionLive = Layer.effect(
  Session,
  Effect.gen(function* () {
    const { token, actor } = yield* OwnerToken;
    const expected = Redacted.value(token);
    return (effect, { headers }) =>
      Option.match(bearerOf(headers), {
        onNone: () => Effect.fail(new Unauthorized()),
        onSome: (given) =>
          sameSecret(given, expected)
            ? Effect.provideService(effect, CurrentActor, actor)
            : Effect.fail(new Unauthorized()),
      });
  }),
);
