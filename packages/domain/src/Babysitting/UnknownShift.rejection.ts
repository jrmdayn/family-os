import * as Domain from "@alchemy.run/domain";
import { ShiftId } from "./Shift.id.ts";

export class UnknownShift extends Domain.Rejection(
  "UnknownShift",
  { shiftId: ShiftId },
  { description: "The sitter has no shift with this id. Look it up in their SitterStatement." },
) {}
