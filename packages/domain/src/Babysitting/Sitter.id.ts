import * as Schema from "effect/Schema";

/**
 * A babysitter, identified by a slug chosen when they are registered, usually
 * of their name: "Maria" is `maria`, "Ana Lucía" is `ana-lucia`.
 */
export const SitterId = Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/))
  .pipe(Schema.brand("SitterId"))
  .annotate({
    description:
      'A babysitter\'s id: lowercase letters, digits and dashes, usually a slug of their name ("maria", "ana-lucia"). Find it in SitterDirectory.',
  });
export type SitterId = typeof SitterId.Type;
