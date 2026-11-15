import * as Schema from "effect/Schema";

/**
 * A babysitter, identified by a slug of their name when they were registered:
 * "Maria" is `maria`, "Ana Lucía" is `ana-lucia`.
 */
export const SitterId = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
  .pipe(Schema.brand("SitterId"))
  .annotate({
    description: 'A babysitter\'s id, a slug of their name ("maria"). Find it in SitterDirectory.',
  });
export type SitterId = typeof SitterId.Type;

/** "Ana Lucía" → "ana-lucia". Empty when the name has no letter or digit. */
export const slugOf = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
