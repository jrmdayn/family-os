import * as Domain from "@alchemy.run/domain";
import { PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { RateNotAfterLatest } from "./RateNotAfterLatest.rejection.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A sitter's hourly rate changed, from a given day on. */
export class SitterRateSet extends Domain.Event("SitterRateSet", {
  centsPerHour: PositiveCents,
  effectiveFrom: IsoDate,
}) {}

export class SetSitterRate extends Domain.Command(
  "SetSitterRate",
  {
    target: SitterId,
    middleware: [Session],
    input: { centsPerHour: PositiveCents, effectiveFrom: IsoDate },
    events: [SitterRateSet],
    rejects: [UnknownSitter, SitterNotActive, RateNotAfterLatest],
    reply: { centsPerHour: PositiveCents, effectiveFrom: IsoDate },
  },
  {
    description:
      "Set one sitter's hourly rate, in cents, from `effectiveFrom` on. Use SetHourlyRate instead to change everyone's rate. It must start after the sitter's latest rate. Records nothing when the rate doesn't change. Shifts already logged keep their price; correct them to re-price.",
  },
) {}
