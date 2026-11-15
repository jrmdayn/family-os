import * as Domain from "@alchemy.run/domain";
import { IsoDate } from "../Time.ts";

export class NoRateForDate extends Domain.Rejection(
  "NoRateForDate",
  { date: IsoDate },
  { description: "No hourly rate applies on this date yet. Set one with SetHourlyRate." },
) {}
