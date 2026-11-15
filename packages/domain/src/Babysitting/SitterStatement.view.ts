import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { Ledger } from "./Ledger.aggregate.ts";
import { anySignedInCaller } from "./signedIn.ts";
import { SitterId } from "./Sitter.id.ts";

/**
 * One line of a sitter's statement: a shift, a payment, or a correction or
 * cancellation of one. `amount` is what the line adds to the balance
 * (negative for payments and cancelled shifts).
 */
export class StatementLine extends Domain.Event("StatementLine", {
  kind: Schema.Literals([
    "shift",
    "shift-corrected",
    "shift-cancelled",
    "payment",
    "payment-cancelled",
  ]),
  /** The shift or payment the line is about. */
  reference: Schema.String,
  date: IsoDate,
  minutes: Schema.NullOr(Schema.Int),
  centsPerHour: Schema.NullOr(Schema.Int),
  note: Schema.NullOr(Schema.String),
  amount: Cents,
  balance: Cents,
}) {}

const line = (
  fields: Partial<StatementLine> &
    Pick<StatementLine, "kind" | "reference" | "date" | "amount" | "balance">,
) => new StatementLine({ minutes: null, centsPerHour: null, note: null, ...fields });

/** Every shift and payment of one sitter, oldest first. */
export class SitterStatement extends Domain.View(
  "SitterStatement",
  {
    from: [Ledger],
    key: SitterId,
    keyOf: { Ledger: ({ event }) => ("sitterId" in event ? event.sitterId : undefined) },
    middleware: [Session],
    events: [StatementLine],
    emit: {
      ShiftLogged: (e) =>
        line({
          kind: "shift",
          reference: e.shiftId,
          date: e.date,
          minutes: e.minutes,
          centsPerHour: e.centsPerHour,
          note: e.note,
          amount: e.amount,
          balance: e.balanceAfter,
        }),
      ShiftCorrected: (e) =>
        line({
          kind: "shift-corrected",
          reference: e.shiftId,
          date: e.date,
          minutes: e.minutes,
          centsPerHour: e.centsPerHour,
          note: e.note,
          amount: e.amount - e.previousAmount,
          balance: e.balanceAfter,
        }),
      ShiftCancelled: (e) =>
        line({
          kind: "shift-cancelled",
          reference: e.shiftId,
          date: e.date,
          amount: -e.amount,
          balance: e.balanceAfter,
        }),
      PaymentRecorded: (e) =>
        line({
          kind: "payment",
          reference: e.paymentId,
          date: e.date,
          amount: -e.amount,
          balance: e.balanceAfter,
        }),
      PaymentCancelled: (e) =>
        line({
          kind: "payment-cancelled",
          reference: e.paymentId,
          date: e.date,
          amount: e.amount,
          balance: e.balanceAfter,
        }),
    },
  },
  {
    description:
      "A sitter's statement: one line per shift, payment, correction or cancellation, with the balance after each. Read it with list (newest first with order desc). Key: the sitter's id. Line references are the shift and payment ids to correct or cancel.",
  },
) {}

export const SitterStatementLive = SitterStatement.toLayer(anySignedInCaller);
