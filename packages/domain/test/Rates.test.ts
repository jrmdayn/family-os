import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import { SitterArchived } from "../src/Babysitting/ArchiveSitter.command.ts";
import { HourlyRates } from "../src/Babysitting/HourlyRates.view.ts";
import { RateNotAfterLatest } from "../src/Babysitting/RateNotAfterLatest.rejection.ts";
import { RegisterSitter, SitterRegistered } from "../src/Babysitting/RegisterSitter.command.ts";
import { HourlyRateSet, SetHourlyRate } from "../src/Babysitting/SetHourlyRate.command.ts";
import { SetSitterRate, SitterRateSet } from "../src/Babysitting/SetSitterRate.command.ts";
import { SitterBalance } from "../src/Babysitting/SitterBalance.view.ts";
import { SitterNotActive } from "../src/Babysitting/SitterNotActive.rejection.ts";
import { UnknownSitter } from "../src/Babysitting/UnknownSitter.rejection.ts";
import {
  ana,
  anaBook,
  anaJoined,
  asOwner,
  maria,
  mariaBook,
  mariaJoined,
  rate2026,
  rateCard,
  sitterRate2026,
  story,
  sunday,
} from "./fixtures.ts";

describe("SetHourlyRate", () => {
  it.effect("sets the household's first rate", () =>
    story(
      sunday,
      asOwner,
      Story.view(HourlyRates, rateCard, Story.none),
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1500, effectiveFrom: "2026-01-01" })),
      Story.then(rateCard, rate2026),
      Story.replied({ centsPerHour: 1500, effectiveFrom: "2026-01-01" }),
      Story.view(HourlyRates, rateCard, {
        rates: [{ centsPerHour: 1500, effectiveFrom: "2026-01-01" }],
      }),
    ),
  );

  it.effect("adds a later rate, possibly in the future", () =>
    story(
      sunday,
      Story.given(rateCard, rate2026),
      asOwner,
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(rateCard, new HourlyRateSet({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.view(HourlyRates, rateCard, {
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
      Story.given(rateCard, rate2026),
      asOwner,
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2026-01-01" })),
      Story.rejected(new RateNotAfterLatest({ latestEffectiveFrom: "2026-01-01" })),
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2025-06-01" })),
      Story.rejected(new RateNotAfterLatest({ latestEffectiveFrom: "2026-01-01" })),
    ),
  );

  it.effect("records nothing when the rate doesn't change", () =>
    story(
      sunday,
      Story.given(rateCard, rate2026),
      asOwner,
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1500, effectiveFrom: "2027-01-01" })),
      Story.then(rateCard),
      Story.replied({ centsPerHour: 1500, effectiveFrom: "2026-01-01" }),
    ),
  );

  it.effect("applies the new rate to every active sitter, not to archived ones", () =>
    story(
      sunday,
      Story.given(rateCard, rate2026),
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      Story.given(anaBook, anaJoined, sitterRate2026, new SitterArchived({})),
      asOwner,
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(rateCard, new HourlyRateSet({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(mariaBook, new SitterRateSet({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(anaBook),
      Story.view(SitterBalance, mariaBook, {
        rates: [
          { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
          { centsPerHour: 1600, effectiveFrom: "2027-01-01" },
        ],
      }),
    ),
  );

  it.effect("leaves a sitter whose own rate starts on or after it alone", () =>
    story(
      sunday,
      Story.given(rateCard, rate2026),
      Story.given(
        mariaBook,
        mariaJoined,
        sitterRate2026,
        new SitterRateSet({ centsPerHour: 1700, effectiveFrom: "2027-02-01" }),
      ),
      asOwner,
      Story.when(rateCard, new SetHourlyRate({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(rateCard, new HourlyRateSet({ centsPerHour: 1600, effectiveFrom: "2027-01-01" })),
      Story.then(mariaBook),
    ),
  );
});

describe("A new sitter", () => {
  it.effect("gets the household's whole rate schedule", () =>
    story(
      sunday,
      Story.given(
        rateCard,
        new HourlyRateSet({ centsPerHour: 1400, effectiveFrom: "2025-01-01" }),
        rate2026,
      ),
      asOwner,
      Story.when(mariaBook, new RegisterSitter({ name: "Maria" })),
      Story.then(
        mariaBook,
        new SitterRegistered({ name: "Maria", aliases: [], iban: null }),
        new SitterRateSet({ centsPerHour: 1400, effectiveFrom: "2025-01-01" }),
        sitterRate2026,
      ),
      Story.view(SitterBalance, mariaBook, {
        rates: [
          { centsPerHour: 1400, effectiveFrom: "2025-01-01" },
          { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
        ],
      }),
    ),
  );

  it.effect("has no rate while the household has none", () =>
    story(
      sunday,
      asOwner,
      Story.when(mariaBook, new RegisterSitter({ name: "Maria" })),
      Story.then(mariaBook, new SitterRegistered({ name: "Maria", aliases: [], iban: null })),
      Story.view(SitterBalance, mariaBook, { rates: [] }),
    ),
  );
});

describe("SetSitterRate", () => {
  it.effect("changes one sitter's rate, and no one else's", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      Story.given(anaBook, anaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new SetSitterRate({ centsPerHour: 1700, effectiveFrom: "2026-11-01" })),
      Story.then(mariaBook, new SitterRateSet({ centsPerHour: 1700, effectiveFrom: "2026-11-01" })),
      Story.replied({ centsPerHour: 1700, effectiveFrom: "2026-11-01" }),
      Story.then(anaBook),
    ),
  );

  it.effect("refuses a rate that doesn't start after the sitter's latest one", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new SetSitterRate({ centsPerHour: 1700, effectiveFrom: "2026-01-01" })),
      Story.rejected(new RateNotAfterLatest({ latestEffectiveFrom: "2026-01-01" })),
    ),
  );

  it.effect("records nothing when the rate doesn't change", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new SetSitterRate({ centsPerHour: 1500, effectiveFrom: "2027-01-01" })),
      Story.then(mariaBook),
      Story.replied({ centsPerHour: 1500, effectiveFrom: "2026-01-01" }),
    ),
  );

  it.effect("refuses an unknown or archived sitter", () =>
    story(
      sunday,
      asOwner,
      Story.when(anaBook, new SetSitterRate({ centsPerHour: 1500, effectiveFrom: "2026-01-01" })),
      Story.rejected(new UnknownSitter({ sitterId: ana })),
      Story.given(mariaBook, mariaJoined, new SitterArchived({})),
      Story.when(mariaBook, new SetSitterRate({ centsPerHour: 1500, effectiveFrom: "2026-01-01" })),
      Story.rejected(new SitterNotActive({ sitterId: maria })),
    ),
  );
});
