import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { DateInFuture } from "./DateInFuture.rejection.ts";
import { LedgerId } from "./Ledger.id.ts";
import { PaymentId } from "./Shift.id.ts";
import { SitterId } from "./Sitter.id.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** Money was wired to a sitter. */
export class PaymentRecorded extends Domain.Event("PaymentRecorded", {
  paymentId: PaymentId,
  sitterId: SitterId,
  date: IsoDate,
  amount: PositiveCents,
  balanceAfter: Cents,
}) {}

export class NothingOwed extends Domain.Rejection(
  "NothingOwed",
  { sitterId: SitterId, balance: Cents },
  { description: "Nothing is owed to this sitter, so there is nothing to pay." },
) {}

export class MoreThanOwed extends Domain.Rejection(
  "MoreThanOwed",
  { sitterId: SitterId, balance: Cents, amount: PositiveCents },
  { description: "The payment is larger than what the sitter is owed." },
) {}

export class RecordPayment extends Domain.Command(
  "RecordPayment",
  {
    target: LedgerId,
    middleware: [Session],
    input: {
      sitterId: SitterId,
      amount: Schema.optionalKey(PositiveCents),
      date: Schema.optionalKey(IsoDate),
    },
    events: [PaymentRecorded],
    rejects: [UnknownSitter, NothingOwed, MoreThanOwed, DateInFuture],
    reply: { paymentId: PaymentId, amount: PositiveCents, balance: Cents },
  },
  {
    description:
      'Record a transfer made to a sitter ("I paid Maria"). Leave amount out to pay their whole balance, and date out for today. It can\'t exceed what they are owed.',
  },
) {}
