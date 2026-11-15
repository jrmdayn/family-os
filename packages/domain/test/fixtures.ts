import { Story } from "@alchemy.run/domain/Story";
import { owner } from "../src/Actor.ts";
import { Ledger } from "../src/Babysitting/Ledger.aggregate.ts";
import { HOME } from "../src/Babysitting/Ledger.id.ts";
import { ShiftLogged } from "../src/Babysitting/LogShift.command.ts";
import { SitterRegistered } from "../src/Babysitting/RegisterSitter.command.ts";
import { HourlyRateSet } from "../src/Babysitting/SetHourlyRate.command.ts";
import { SitterId } from "../src/Babysitting/Sitter.id.ts";
import { CurrentActor } from "../src/CurrentActor.context.ts";
import { FamilyOs, FamilyOsHandlers } from "../src/FamilyOs.model.ts";

export const story = Story.make(FamilyOs, { layer: FamilyOsHandlers });

/** The household's one ledger. */
export const home = Ledger.ref(HOME);

/** What the session middleware provides for the household's owner. */
export const asOwner = Story.provide(CurrentActor, owner("owner@example.com"));

/** Sunday 15 November 2026, 10:00 in Paris. */
export const sunday = Story.clock("2026-11-15T09:00:00Z");

export const maria = SitterId.make("maria");
export const ana = SitterId.make("ana");

export const MARIA_IBAN = "FR7630006000011234567890189";
export const ANA_IBAN = "DE89370400440532013000";

export const rate2026 = new HourlyRateSet({ centsPerHour: 1500, effectiveFrom: "2026-01-01" });

export const mariaJoined = new SitterRegistered({
  sitterId: maria,
  name: "Maria",
  aliases: ["Mari"],
  iban: MARIA_IBAN,
});

export const anaJoined = new SitterRegistered({
  sitterId: ana,
  name: "Ana",
  aliases: [],
  iban: ANA_IBAN,
});

/** Maria babysat 4 hours on Friday 13 November 2026, at €15/h. */
export const mariaFriday = new ShiftLogged({
  shiftId: "maria-2026-11-13",
  sitterId: maria,
  date: "2026-11-13",
  minutes: 240,
  centsPerHour: 1500,
  amount: 6000,
  note: null,
  balanceAfter: 6000,
});
