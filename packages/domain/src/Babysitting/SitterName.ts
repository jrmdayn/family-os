import * as Schema from "effect/Schema";

/** A name a person goes by: trimmed, with at least one letter or digit. */
export const SitterName = Schema.Trimmed.check(
  Schema.isMinLength(1),
  Schema.isPattern(/[\p{L}\p{N}]/u),
).annotate({ description: 'A name, e.g. "Maria" or "Ana Lucía".' });
