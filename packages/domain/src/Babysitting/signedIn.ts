import * as Effect from "effect/Effect";

/**
 * Every read is judged by its view's `validate`. The household has one
 * owner, and the session middleware has already refused anyone else, so a
 * signed-in caller may read everything.
 */
export const anySignedInCaller = Effect.succeed(Effect.fn(function* () {}));
