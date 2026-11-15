import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { Ledger } from "./Ledger.aggregate.ts";
import { anySignedInCaller } from "./signedIn.ts";

/** Every hourly rate, oldest first. */
export class HourlyRates extends Domain.View(
  "HourlyRates",
  {
    from: [Ledger],
    key: Ledger,
    middleware: [Session],
    state: Schema.Struct({
      rates: Schema.Array(Schema.Struct({ centsPerHour: PositiveCents, effectiveFrom: IsoDate })),
    }),
    initial: { rates: [] },
    evolve: {
      HourlyRateSet: (v, e) => ({
        rates: [...v.rates, { centsPerHour: e.centsPerHour, effectiveFrom: e.effectiveFrom }],
      }),
    },
  },
  {
    description:
      'The hourly rates paid to every sitter, in cents, oldest first. A rate applies from its effectiveFrom date until the next one. Key: always "home".',
  },
) {}

export const HourlyRatesLive = HourlyRates.toLayer(anySignedInCaller);
