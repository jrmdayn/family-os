import * as Domain from "@alchemy.run/domain";
import { PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { Household } from "./Household.ts";
import { RateNotAfterLatest } from "./RateNotAfterLatest.rejection.ts";

/** The household's hourly rate changed, from a given day on. Every active sitter gets it. */
export class HourlyRateSet extends Domain.Event("HourlyRateSet", {
  centsPerHour: PositiveCents,
  effectiveFrom: IsoDate,
}) {}

export class SetHourlyRate extends Domain.Command(
  "SetHourlyRate",
  {
    target: Household,
    middleware: [Session],
    input: { centsPerHour: PositiveCents, effectiveFrom: IsoDate },
    events: [HourlyRateSet],
    rejects: [RateNotAfterLatest],
    reply: { centsPerHour: PositiveCents, effectiveFrom: IsoDate },
  },
  {
    description:
      "Set the household's hourly rate, in cents, from `effectiveFrom` on (e.g. €15/h from 2027-01-01 is centsPerHour 1500, effectiveFrom 2027-01-01). Target: always \"home\". It must start after the latest household rate. It then applies to every active sitter, and to every sitter registered later; a sitter whose own rate (SetSitterRate) starts on or after that date keeps theirs. Applying it to the sitters takes a moment: check a sitter's rates in SitterBalance. Shifts already logged keep their price; correct them to re-price.",
  },
) {}
