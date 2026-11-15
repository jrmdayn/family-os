import * as Domain from "@alchemy.run/domain";
import { ShiftId } from "./Shift.id.ts";

export class UnknownShift extends Domain.Rejection(
  "UnknownShift",
  { shiftId: ShiftId },
  { description: "No shift has this id. Look it up in the sitter's SitterStatement." },
) {}
