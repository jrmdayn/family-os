import * as Schema from "effect/Schema";

/** An amount of money in euro cents. */
export const Cents = Schema.Int.annotate({
  description: "An amount in euro cents (1500 = €15.00).",
});
export type Cents = typeof Cents.Type;

/** A strictly positive amount of money in euro cents. */
export const PositiveCents = Cents.check(Schema.isGreaterThan(0)).annotate({
  description: "A positive amount in euro cents (1500 = €15.00).",
});

/** What `minutes` of work cost at `centsPerHour`, rounded to the cent. */
export const priceOf = (minutes: number, centsPerHour: number): Cents =>
  Math.round((minutes * centsPerHour) / 60);
