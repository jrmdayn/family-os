import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { Rate } from "./Rate.ts";
import { RateCard } from "./RateCard.aggregate.ts";
import { anySignedInCaller } from "./signedIn.ts";

/** The household's hourly rates, oldest first. */
export class HourlyRates extends Domain.View(
  "HourlyRates",
  {
    from: [RateCard],
    key: RateCard,
    middleware: [Session],
    state: Schema.Struct({ rates: Schema.Array(Rate) }),
    initial: { rates: [] },
    evolve: {
      HourlyRateSet: (v, e) => ({
        rates: [...v.rates, { centsPerHour: e.centsPerHour, effectiveFrom: e.effectiveFrom }],
      }),
    },
  },
  {
    description:
      "The household's hourly rates, in cents, oldest first: what every sitter is paid unless they have their own rate. A rate applies from its effectiveFrom date until the next one. A sitter's own rates are in their SitterBalance. Key: always \"home\". The value is null until the first household rate is set with SetHourlyRate: null means no rates yet, not an error.",
  },
) {}

export const HourlyRatesLive = HourlyRates.toLayer(anySignedInCaller);
