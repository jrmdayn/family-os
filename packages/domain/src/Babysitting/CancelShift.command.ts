import * as Domain from "@alchemy.run/domain";
import { Cents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { ShiftId } from "./Shift.id.ts";
import { ShiftAlreadyCancelled } from "./ShiftAlreadyCancelled.rejection.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownShift } from "./UnknownShift.rejection.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A logged shift didn't happen, or was logged by mistake: its amount is no longer owed. */
export class ShiftCancelled extends Domain.Event("ShiftCancelled", {
  shiftId: ShiftId,
  date: IsoDate,
  amount: Cents,
  balanceAfter: Cents,
}) {}

export class CancelShift extends Domain.Command(
  "CancelShift",
  {
    target: SitterId,
    middleware: [Session],
    input: { shiftId: ShiftId },
    events: [ShiftCancelled],
    rejects: [UnknownSitter, UnknownShift, ShiftAlreadyCancelled, SitterNotActive],
    reply: { shiftId: ShiftId, balance: Cents },
  },
  {
    description:
      "Cancel one of a sitter's logged shifts, e.g. one logged twice or for the wrong sitter. Its amount is taken off the sitter's balance.",
  },
) {}
