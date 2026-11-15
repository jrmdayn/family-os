import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import { HourlyRates } from "../src/Babysitting/HourlyRates.view.ts";
import {
  HourlyRateSet,
  RateNotAfterLatest,
  SetHourlyRate,
} from "../src/Babysitting/SetHourlyRate.command.ts";
import { asOwner, home, rate2026, story, sunday } from "./fixtures.ts";

describe("SetHourlyRate", () => {
  it.effect("sets the first rate", () =>
    story(
      sunday,
      asOwner,
      Story.when(home, new SetHourlyRate({ centsPerHour: 1500, effectiveFrom: "2026-01-01" })),
      Story.then(home, new HourlyRateSet({ centsPerHour: 1500, effectiveFrom: "2026-01-01" })),
      Story.replied({ centsPerHour: 1500, effectiveFrom: "2026-01-01" }),
      Story.view(HourlyRates, home, {
        rates: [{ centsPerHour: 1500, effectiveFrom: "2026-01-01" }],
      }),
    ),
  );

  it.effect("adds a later rate, possibly in the future", () =>
    story(
      sunday,
      Story.given(home, rate2026),
      asOwner,
      Story.when(home, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(home, new HourlyRateSet({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.view(HourlyRates, home, {
        rates: [
          { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
          { centsPerHour: 1600, effectiveFrom: "2027-01-01" },
        ],
      }),
    ),
  );

  it.effect("refuses a rate that doesn't start after the latest one", () =>
    story(
      sunday,
      Story.given(home, rate2026),
      asOwner,
      Story.when(home, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2026-01-01" })),
      Story.rejected(new RateNotAfterLatest({ latestEffectiveFrom: "2026-01-01" })),
      Story.when(home, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2025-06-01" })),
      Story.rejected(new RateNotAfterLatest({ latestEffectiveFrom: "2026-01-01" })),
    ),
  );

  it.effect("records nothing when the rate doesn't change", () =>
    story(
      sunday,
      Story.given(home, rate2026),
      asOwner,
      Story.when(home, new SetHourlyRate({ centsPerHour: 1500, effectiveFrom: "2027-01-01" })),
      Story.then(home),
      Story.replied({ centsPerHour: 1500, effectiveFrom: "2026-01-01" }),
    ),
  );
});
