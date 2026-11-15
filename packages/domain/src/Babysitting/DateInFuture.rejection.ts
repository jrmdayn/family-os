import * as Domain from "@alchemy.run/domain";
import { IsoDate } from "../Time.ts";

export class DateInFuture extends Domain.Rejection(
  "DateInFuture",
  { date: IsoDate, today: IsoDate },
  {
    description:
      "The date is after today (Europe/Paris). Only past and present days can be recorded.",
  },
) {}
