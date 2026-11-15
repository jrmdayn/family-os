import * as Schema from "effect/Schema";

/**
 * The household. One deployment serves one household, so its key is a
 * constant: the rate card's id, and the key of every view about all sitters.
 */
export const Household = Schema.Literal("home").annotate({
  description: 'The household. Always "home".',
});
export type Household = typeof Household.Type;

export const HOME: Household = "home";
