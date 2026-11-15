import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Household } from "./Household.ts";
import { Rate } from "./Rate.ts";
import { RateNotAfterLatest } from "./RateNotAfterLatest.rejection.ts";
import { HourlyRateSet, SetHourlyRate } from "./SetHourlyRate.command.ts";

/**
 * The household's hourly rate schedule, oldest first: what every sitter is
 * paid unless they have their own rate. There is one, keyed `"home"`. It
 * prices nothing itself: `HourlyRateRollout` copies each rate to every active
 * sitter, and `HourlyRateOnboarding` gives the whole schedule to a new sitter.
 */
export class RateCard extends Domain.Aggregate("RateCard", {
  id: Household,
  state: Schema.Struct({ rates: Schema.Array(Rate) }),
  initial: { rates: [] },
  commands: [SetHourlyRate],
  decide: {
    SetHourlyRate: (state, cmd) => {
      const latest = state.rates.at(-1);
      if (latest && cmd.effectiveFrom <= latest.effectiveFrom) {
        return new RateNotAfterLatest({ latestEffectiveFrom: latest.effectiveFrom });
      }
      if (latest && latest.centsPerHour === cmd.centsPerHour) return [];
      return [
        new HourlyRateSet({ centsPerHour: cmd.centsPerHour, effectiveFrom: cmd.effectiveFrom }),
      ];
    },
  },
  evolve: {
    HourlyRateSet: (s, e) => ({
      rates: [...s.rates, { centsPerHour: e.centsPerHour, effectiveFrom: e.effectiveFrom }],
    }),
  },
  reply: {
    SetHourlyRate: (s) => {
      const latest = s.rates.at(-1);
      return {
        centsPerHour: latest?.centsPerHour ?? 1,
        effectiveFrom: latest?.effectiveFrom ?? "1970-01-01",
      };
    },
  },
}) {}
