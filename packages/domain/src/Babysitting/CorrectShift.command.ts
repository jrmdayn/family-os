import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate, Minutes } from "../Time.ts";
import { DateInFuture } from "./DateInFuture.rejection.ts";
import { LedgerId } from "./Ledger.id.ts";
import { NoRateForDate } from "./NoRateForDate.rejection.ts";
import { ShiftId } from "./Shift.id.ts";
import { ShiftAlreadyCancelled } from "./ShiftAlreadyCancelled.rejection.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownShift } from "./UnknownShift.rejection.ts";

/** A logged shift was corrected, and re-priced at the rate of its (new) day. */
export class ShiftCorrected extends Domain.Event("ShiftCorrected", {
  shiftId: ShiftId,
  sitterId: SitterId,
  date: IsoDate,
  minutes: Minutes,
  centsPerHour: PositiveCents,
  amount: Cents,
  previousAmount: Cents,
  note: Schema.NullOr(Schema.String),
  balanceAfter: Cents,
}) {}

export class NothingToCorrect extends Domain.Rejection(
  "NothingToCorrect",
  { shiftId: ShiftId },
  { description: "The shift already has this date, duration, note and price." },
) {}

export class CorrectShift extends Domain.Command(
  "CorrectShift",
  {
    target: LedgerId,
    middleware: [Session],
    input: {
      shiftId: ShiftId,
      date: Schema.optionalKey(IsoDate),
      minutes: Schema.optionalKey(Minutes),
      note: Schema.optionalKey(Schema.NullOr(Schema.String)),
    },
    events: [ShiftCorrected],
    rejects: [
      UnknownShift,
      ShiftAlreadyCancelled,
      NothingToCorrect,
      SitterNotActive,
      NoRateForDate,
      DateInFuture,
    ],
    reply: { shiftId: ShiftId, amount: Cents, balance: Cents },
  },
  {
    description:
      "Correct a logged shift's date, minutes or note. Fields left out stay as they are. The shift is re-priced at the rate in force on its date, which also applies a rate change made after it was logged. To move a shift to another sitter, cancel it and log a new one.",
  },
) {}
