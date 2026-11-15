import * as Domain from "@alchemy.run/domain";
import { IsoDate } from "../Time.ts";

export class RateNotAfterLatest extends Domain.Rejection(
  "RateNotAfterLatest",
  { latestEffectiveFrom: IsoDate },
  { description: "A new rate must take effect after the latest one. Rates are never rewritten." },
) {}
