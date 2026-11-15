import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { Rate } from "./Rate.ts";
import { anySignedInCaller } from "./signedIn.ts";
import { Sitter } from "./Sitter.aggregate.ts";

const withBalance = <V extends { balance: number }>(
  v: V,
  e: { readonly balanceAfter: number },
) => ({
  ...v,
  balance: e.balanceAfter,
});

/** What one sitter is owed now, the rates they are paid, and their last payment. */
export class SitterBalance extends Domain.View(
  "SitterBalance",
  {
    from: [Sitter],
    key: Sitter,
    middleware: [Session],
    state: Schema.Struct({
      name: Schema.String,
      active: Schema.Boolean,
      balance: Cents,
      rates: Schema.Array(Rate),
      lastPayment: Schema.NullOr(Schema.Struct({ date: IsoDate, amount: PositiveCents })),
    }),
    initial: { name: "", active: true, balance: 0, rates: [], lastPayment: null },
    evolve: {
      SitterRegistered: (v, e) => ({ ...v, name: e.name }),
      SitterDetailsChanged: (v, e) => ({ ...v, name: e.name }),
      SitterArchived: (v) => ({ ...v, active: false }),
      SitterRateSet: (v, e) => ({
        ...v,
        rates: [...v.rates, { centsPerHour: e.centsPerHour, effectiveFrom: e.effectiveFrom }],
      }),
      ShiftLogged: withBalance,
      ShiftCorrected: withBalance,
      ShiftCancelled: withBalance,
      PaymentRecorded: (v, e) => ({
        ...withBalance(v, e),
        lastPayment: { date: e.date, amount: e.amount },
      }),
      PaymentCancelled: withBalance,
    },
  },
  {
    description:
      "One sitter's balance in cents (what you owe them; negative means they owe you), whether they are active, the hourly rates they are paid (oldest first, each from its effectiveFrom date until the next), and their last payment. Key: the sitter's id.",
  },
) {}

export const SitterBalanceLive = SitterBalance.toLayer(anySignedInCaller);
