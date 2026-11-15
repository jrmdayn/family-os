import * as Schema from "effect/Schema";

/**
 * A logged shift, unique within its sitter: the day, plus a counter when the
 * sitter babysat more than once that day (`2026-11-13`, `2026-11-13-2`).
 */
export const ShiftId = Schema.String.annotate({
  description:
    'A shift\'s id within its sitter: its date, plus "-2", "-3" for more shifts that day ("2026-11-13"). Find it in SitterStatement.',
});
export type ShiftId = typeof ShiftId.Type;

/** A recorded payment, unique within its sitter: `paid-2026-11-15`. */
export const PaymentId = Schema.String.annotate({
  description:
    'A payment\'s id within its sitter: "paid-<date>" ("paid-2026-11-15"). Find it in SitterStatement.',
});
export type PaymentId = typeof PaymentId.Type;

/** The first of `base`, `base-2`, `base-3`, … that `taken` doesn't hold. */
export const nextId = (base: string, taken: Readonly<Record<string, unknown>>): string => {
  if (!(base in taken)) return base;
  let n = 2;
  while (`${base}-${n}` in taken) n++;
  return `${base}-${n}`;
};
