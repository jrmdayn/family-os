import { Actor } from "@family-os/domain/Actor";
import { CurrentActor } from "@family-os/domain/CurrentActor.context";
import { Session, Unauthorized } from "@family-os/domain/Session.middleware";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

/**
 * The bearer token that signs the owner in, and who it signs in as. A
 * stand-in until sign-in with Google and OAuth (M3): one secret token, kept
 * out of logs and traces as a Redacted value.
 */
export class OwnerToken extends Context.Service<
  OwnerToken,
  { readonly token: Redacted.Redacted<string>; readonly actor: Actor }
>()("FamilyOs/OwnerToken") {}

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
