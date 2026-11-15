import * as Schema from "effect/Schema";

/**
 * A logged shift: the sitter and the day, plus a counter when the sitter
 * babysat more than once that day (`maria-2026-11-13`, `maria-2026-11-13-2`).
 */
export const ShiftId = Schema.String.annotate({
  description: 'A shift\'s id, "<sitter>-<date>" ("maria-2026-11-13"). Find it in SitterStatement.',
});
export type ShiftId = typeof ShiftId.Type;

/**
 * A recorded payment: the sitter and the day it was made
 * (`maria-paid-2026-11-15`).
 */
export const PaymentId = Schema.String.annotate({
  description: 'A payment\'s id, "<sitter>-paid-<date>". Find it in SitterStatement.',
});
export type PaymentId = typeof PaymentId.Type;

/** The first of `base`, `base-2`, `base-3`, … that `taken` doesn't hold. */
export const nextId = (base: string, taken: Readonly<Record<string, unknown>>): string => {
  if (!(base in taken)) return base;
  let n = 2;
  while (`${base}-${n}` in taken) n++;
  return `${base}-${n}`;
};
