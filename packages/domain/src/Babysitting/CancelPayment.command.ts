import * as Domain from "@alchemy.run/domain";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { PaymentId } from "./Shift.id.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A recorded payment didn't happen: its amount is owed again. */
export class PaymentCancelled extends Domain.Event("PaymentCancelled", {
  paymentId: PaymentId,
  date: IsoDate,
  amount: PositiveCents,
  balanceAfter: Cents,
}) {}

export class UnknownPayment extends Domain.Rejection(
  "UnknownPayment",
  { paymentId: PaymentId },
  { description: "The sitter has no payment with this id. Look it up in their SitterStatement." },
) {}

export class PaymentAlreadyCancelled extends Domain.Rejection(
  "PaymentAlreadyCancelled",
  { paymentId: PaymentId },
  { description: "The payment is already cancelled." },
) {}

export class CancelPayment extends Domain.Command(
  "CancelPayment",
  {
    target: SitterId,
    middleware: [Session],
    input: { paymentId: PaymentId },
    events: [PaymentCancelled],
    rejects: [UnknownSitter, UnknownPayment, PaymentAlreadyCancelled, SitterNotActive],
    reply: { paymentId: PaymentId, balance: Cents },
  },
  {
    description:
      "Cancel a payment to a sitter recorded by mistake: its amount is owed to the sitter again.",
  },
) {}
