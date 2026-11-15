import * as Schema from "effect/Schema";
import { PositiveCents } from "../Money.ts";
import { IsoDate } from "../Time.ts";

/** An hourly rate, in cents, from `effectiveFrom` until the next rate. */
export const Rate = Schema.Struct({ centsPerHour: PositiveCents, effectiveFrom: IsoDate });
export type Rate = typeof Rate.Type;

/** The rate in force on `date`: the latest one that took effect on or before it. */
export const rateOn = (rates: ReadonlyArray<Rate>, date: string): Rate | undefined =>
  rates.findLast((rate) => rate.effectiveFrom <= date);
