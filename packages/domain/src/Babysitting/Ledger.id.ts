import * as Schema from "effect/Schema";

/**
 * The household's babysitting ledger. There is exactly one, so its id is a
 * constant: every command targets `"home"`.
 */
export const LedgerId = Schema.Literal("home").annotate({
  description: 'The household\'s ledger. Always "home".',
});
export type LedgerId = typeof LedgerId.Type;

export const HOME: LedgerId = "home";
