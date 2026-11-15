import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

/**
 * Who may sign in: the household's owners, by Google email. One deployment
 * is one household, so a second adult is one more email here, not a change
 * to the model.
 */
export class Owners extends Context.Service<
  Owners,
  { readonly emails: ReadonlyArray<string>; readonly includes: (email: string) => boolean }
>()("FamilyOs/Owners") {}

const normalize = (email: string) => email.trim().toLowerCase();

/** The owners, from a list of emails. Matching ignores case. */
export const ownersOf = (emails: ReadonlyArray<string>): Owners["Service"] => {
  const set = new Set(emails.map(normalize));
  return { emails: [...set], includes: (email) => set.has(normalize(email)) };
};

/**
 * `FAMILY_OS_OWNERS`: the owners' emails, separated by commas or spaces. It
 * is a secret, not code, because the repository is public. A deploy without
 * at least one email fails, so nobody is ever let in by an empty list.
 */
const ownersConfig = Config.schema(
  Schema.String.pipe(
    Schema.decodeTo(
      Schema.Array(Schema.String).check(Schema.isMinLength(1)),
      SchemaTransformation.transform({
        decode: (value: string): ReadonlyArray<string> =>
          value.split(/[\s,]+/).filter((email) => email.includes("@")),
        encode: (emails: ReadonlyArray<string>) => emails.join(","),
      }),
    ),
  ),
  "FAMILY_OS_OWNERS",
);

/** The owners from `FAMILY_OS_OWNERS`. `fallback` is for the dev server only. */
export const OwnersFromConfig = (options: { readonly fallback?: ReadonlyArray<string> } = {}) =>
  Layer.effect(
    Owners,
    Effect.gen(function* () {
      const emails = yield* options.fallback === undefined
        ? ownersConfig
        : ownersConfig.pipe(Config.withDefault(options.fallback));
      return ownersOf(emails);
    }),
  );
