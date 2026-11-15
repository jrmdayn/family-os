import * as Domain from "@alchemy.run/domain";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { LedgerId } from "./Ledger.id.ts";
import { PaymentId } from "./Shift.id.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";

/** A recorded payment didn't happen: its amount is owed again. */
export class PaymentCancelled extends Domain.Event("PaymentCancelled", {
  paymentId: PaymentId,
  sitterId: SitterId,
  date: IsoDate,
  amount: PositiveCents,
  balanceAfter: Cents,
}) {}

export class UnknownPayment extends Domain.Rejection(
  "UnknownPayment",
  { paymentId: PaymentId },
  { description: "No payment has this id. Look it up in the sitter's SitterStatement." },
) {}

export class PaymentAlreadyCancelled extends Domain.Rejection(
  "PaymentAlreadyCancelled",
  { paymentId: PaymentId },
  { description: "The payment is already cancelled." },
) {}

export class CancelPayment extends Domain.Command(
  "CancelPayment",
  {
    target: LedgerId,
    middleware: [Session],
    input: { paymentId: PaymentId },
    events: [PaymentCancelled],
    rejects: [UnknownPayment, PaymentAlreadyCancelled, SitterNotActive],
    reply: { paymentId: PaymentId, balance: Cents },
  },
  {
    description: "Cancel a payment recorded by mistake: its amount is owed to the sitter again.",
  },
) {}
