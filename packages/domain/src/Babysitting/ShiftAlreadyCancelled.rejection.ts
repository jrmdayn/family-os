import * as Domain from "@alchemy.run/domain";
import { ShiftId } from "./Shift.id.ts";

export class ShiftAlreadyCancelled extends Domain.Rejection(
  "ShiftAlreadyCancelled",
  { shiftId: ShiftId },
  { description: "The shift is already cancelled." },
) {}
