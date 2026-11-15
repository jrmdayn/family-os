import * as Domain from "@alchemy.run/domain";
import { IsoDate } from "../Time.ts";

export class NoRateForDate extends Domain.Rejection(
  "NoRateForDate",
  { date: IsoDate },
  {
    description:
      "The sitter has no hourly rate on this date yet. Set one with SetHourlyRate (everyone) or SetSitterRate (this sitter).",
  },
) {}
