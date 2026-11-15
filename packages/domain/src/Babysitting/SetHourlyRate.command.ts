import * as Domain from "@alchemy.run/domain";
import { PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { LedgerId } from "./Ledger.id.ts";

/** The hourly rate every sitter is paid changed, from a given day on. */
export class HourlyRateSet extends Domain.Event("HourlyRateSet", {
  centsPerHour: PositiveCents,
  effectiveFrom: IsoDate,
}) {}

export class RateNotAfterLatest extends Domain.Rejection(
  "RateNotAfterLatest",
  { latestEffectiveFrom: IsoDate },
  { description: "A new rate must take effect after the latest one. Rates are never rewritten." },
) {}

export class SetHourlyRate extends Domain.Command(
  "SetHourlyRate",
  {
    target: LedgerId,
    middleware: [Session],
    input: { centsPerHour: PositiveCents, effectiveFrom: IsoDate },
    events: [HourlyRateSet],
    rejects: [RateNotAfterLatest],
    reply: { centsPerHour: PositiveCents, effectiveFrom: IsoDate },
  },
  {
    description:
      "Set the hourly rate paid to every sitter, in cents, from `effectiveFrom` on (e.g. €15/h from 2027-01-01 is centsPerHour 1500, effectiveFrom 2027-01-01). It must start after the latest rate. Shifts already logged keep the rate they were logged with; correct them to re-price.",
  },
) {}
