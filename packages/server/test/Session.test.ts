import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { OwnerToken, OwnerTokenFromConfig } from "../src/Session.ts";

const ownerTokenWith = (env: Record<string, string>, fallback?: string) =>
  Effect.gen(function* () {
    return yield* OwnerToken;
  }).pipe(
    Effect.provide(OwnerTokenFromConfig(fallback === undefined ? {} : { fallback })),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(env)),
  );

it.effect("FAMILY_OS_TOKEN is the owner's token", () =>
  Effect.gen(function* () {
    const token = "x".repeat(64);
    const owner = yield* ownerTokenWith({ FAMILY_OS_TOKEN: token });
    expect(Redacted.value(owner.token)).toBe(token);
  }),
);

it.effect("an empty or short token fails, so a deploy without the secret fails too", () =>
  Effect.gen(function* () {
    // GitHub Actions passes an unset secret as an empty string.
    const empty = yield* ownerTokenWith({ FAMILY_OS_TOKEN: "" }).pipe(Effect.flip);
    expect(empty._tag).toBe("ConfigError");
    const short = yield* ownerTokenWith({ FAMILY_OS_TOKEN: "short" }).pipe(Effect.flip);
    expect(short._tag).toBe("ConfigError");
    const missing = yield* ownerTokenWith({}).pipe(Effect.flip);
    expect(missing._tag).toBe("ConfigError");
  }),
);

it.effect("the dev server falls back to dev-token when FAMILY_OS_TOKEN is unset", () =>
  Effect.gen(function* () {
    const owner = yield* ownerTokenWith({}, "dev-token");
    expect(Redacted.value(owner.token)).toBe("dev-token");
  }),
);
