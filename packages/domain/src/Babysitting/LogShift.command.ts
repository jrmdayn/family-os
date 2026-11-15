import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate, Minutes } from "../Time.ts";
import { DateInFuture } from "./DateInFuture.rejection.ts";
import { LedgerId } from "./Ledger.id.ts";
import { NoRateForDate } from "./NoRateForDate.rejection.ts";
import { ShiftId } from "./Shift.id.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A sitter babysat on a day, for some minutes, priced at the rate of that day. */
export class ShiftLogged extends Domain.Event("ShiftLogged", {
  shiftId: ShiftId,
  sitterId: SitterId,
  date: IsoDate,
  minutes: Minutes,
  centsPerHour: PositiveCents,
  amount: Cents,
  note: Schema.NullOr(Schema.String),
  balanceAfter: Cents,
}) {}

export class LogShift extends Domain.Command(
  "LogShift",
  {
    target: LedgerId,
    middleware: [Session],
    input: {
      sitterId: SitterId,
      date: IsoDate,
      minutes: Minutes,
      note: Schema.optionalKey(Schema.String),
    },
    events: [ShiftLogged],
    rejects: [UnknownSitter, SitterNotActive, NoRateForDate, DateInFuture],
    reply: {
      shiftId: ShiftId,
      sitterId: SitterId,
      date: IsoDate,
      minutes: Minutes,
      centsPerHour: PositiveCents,
      amount: Cents,
      balance: Cents,
      otherShiftsThatDay: Schema.Int,
    },
  },
  {
    description:
      'Log that a sitter babysat: "Maria 4h on Friday" is sitterId "maria", the date of the most recent Friday (today or earlier, YYYY-MM-DD, Europe/Paris) and minutes 240. The shift is priced at the hourly rate in force that day. Replies with the amount and the sitter\'s new balance; otherShiftsThatDay > 0 means this sitter already had a shift that day, so check it isn\'t a duplicate.',
  },
) {}
