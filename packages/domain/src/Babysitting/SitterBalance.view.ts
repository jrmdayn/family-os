import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { Ledger } from "./Ledger.aggregate.ts";
import { anySignedInCaller } from "./signedIn.ts";
import { SitterId } from "./Sitter.id.ts";

const withBalance = <V extends { balance: number }>(
  v: V,
  e: { readonly balanceAfter: number },
) => ({
  ...v,
  balance: e.balanceAfter,
});

/** What one sitter is owed now, and their last payment. */
export class SitterBalance extends Domain.View(
  "SitterBalance",
  {
    from: [Ledger],
    key: SitterId,
    keyOf: { Ledger: ({ event }) => ("sitterId" in event ? event.sitterId : undefined) },
    middleware: [Session],
    state: Schema.Struct({
      name: Schema.String,
      active: Schema.Boolean,
      balance: Cents,
      lastPayment: Schema.NullOr(Schema.Struct({ date: IsoDate, amount: PositiveCents })),
    }),
    initial: { name: "", active: true, balance: 0, lastPayment: null },
    evolve: {
      SitterRegistered: (v, e) => ({ ...v, name: e.name }),
      SitterDetailsChanged: (v, e) => ({ ...v, name: e.name }),
      SitterArchived: (v) => ({ ...v, active: false }),
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
      "One sitter's balance in cents (what you owe them; negative means they owe you), whether they are active, and their last payment. Key: the sitter's id.",
  },
) {}

export const SitterBalanceLive = SitterBalance.toLayer(anySignedInCaller);
