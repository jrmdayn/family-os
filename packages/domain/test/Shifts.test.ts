import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import { SitterArchived } from "../src/Babysitting/ArchiveSitter.command.ts";
import { ShiftCancelled, CancelShift } from "../src/Babysitting/CancelShift.command.ts";
import {
  CorrectShift,
  NothingToCorrect,
  ShiftCorrected,
} from "../src/Babysitting/CorrectShift.command.ts";
import { DateInFuture } from "../src/Babysitting/DateInFuture.rejection.ts";
import { LogShift, ShiftLogged } from "../src/Babysitting/LogShift.command.ts";
import { NoRateForDate } from "../src/Babysitting/NoRateForDate.rejection.ts";
import { SitterRateSet } from "../src/Babysitting/SetSitterRate.command.ts";
import { ShiftAlreadyCancelled } from "../src/Babysitting/ShiftAlreadyCancelled.rejection.ts";
import { SitterBalance } from "../src/Babysitting/SitterBalance.view.ts";
import { SitterNotActive } from "../src/Babysitting/SitterNotActive.rejection.ts";
import { SitterStatement } from "../src/Babysitting/SitterStatement.view.ts";
import { UnknownShift } from "../src/Babysitting/UnknownShift.rejection.ts";
import { UnknownSitter } from "../src/Babysitting/UnknownSitter.rejection.ts";
import {
  asOwner,
  maria,
  mariaBook,
  mariaFriday,
  mariaJoined,
  sitterRate2026,
  story,
  sunday,
} from "./fixtures.ts";

describe("LogShift", () => {
  it.effect("logs 'Maria 4h on Friday' at the rate of the day, and replies with the balance", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2026-11-13", minutes: 240 })),
      Story.then(mariaBook, mariaFriday),
      Story.replied({
        shiftId: "2026-11-13",
        date: "2026-11-13",
        minutes: 240,
        centsPerHour: 1500,
        amount: 6000,
        balance: 6000,
        otherShiftsThatDay: 0,
      }),
      Story.view(SitterBalance, mariaBook, { balance: 6000 }),
      Story.emitted(SitterStatement, mariaBook, [
        {
          kind: "shift",
          reference: "2026-11-13",
          date: "2026-11-13",
          minutes: 240,
          centsPerHour: 1500,
          amount: 6000,
          balance: 6000,
        },
      ]),
    ),
  );

  it.effect("logs today's shift, with a note", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2026-11-15", minutes: 90, note: "bath time" })),
      Story.then(
        mariaBook,
        new ShiftLogged({
          shiftId: "2026-11-15",
          date: "2026-11-15",
          minutes: 90,
          centsPerHour: 1500,
          amount: 2250,
          note: "bath time",
          balanceAfter: 2250,
        }),
      ),
    ),
  );

  it.effect("prices each shift at the rate in force on its day", () =>
    story(
      sunday,
      Story.given(
        mariaBook,
        mariaJoined,
        new SitterRateSet({ centsPerHour: 1400, effectiveFrom: "2025-01-01" }),
        sitterRate2026,
      ),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2025-12-31", minutes: 60 })),
      Story.then(
        mariaBook,
        new ShiftLogged({
          shiftId: "2025-12-31",
          date: "2025-12-31",
          minutes: 60,
          centsPerHour: 1400,
          amount: 1400,
          note: null,
          balanceAfter: 1400,
        }),
      ),
      Story.when(mariaBook, new LogShift({ date: "2026-01-01", minutes: 60 })),
      Story.then(
        mariaBook,
        new ShiftLogged({
          shiftId: "2026-01-01",
          date: "2026-01-01",
          minutes: 60,
          centsPerHour: 1500,
          amount: 1500,
          note: null,
          balanceAfter: 2900,
        }),
      ),
    ),
  );

  it.effect("numbers a second shift on the same day, and says the day already had one", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2026-11-13", minutes: 30 })),
      Story.then(
        mariaBook,
        new ShiftLogged({
          shiftId: "2026-11-13-2",
          date: "2026-11-13",
          minutes: 30,
          centsPerHour: 1500,
          amount: 750,
          note: null,
          balanceAfter: 6750,
        }),
      ),
      Story.replied({
        shiftId: "2026-11-13-2",
        date: "2026-11-13",
        minutes: 30,
        centsPerHour: 1500,
        amount: 750,
        balance: 6750,
        otherShiftsThatDay: 1,
      }),
    ),
  );

  it.effect("rounds the amount to the cent", () =>
    story(
      sunday,
      Story.given(
        mariaBook,
        mariaJoined,
        new SitterRateSet({ centsPerHour: 1333, effectiveFrom: "2026-01-01" }),
      ),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2026-11-13", minutes: 50 })),
      Story.then(
        mariaBook,
        new ShiftLogged({
          shiftId: "2026-11-13",
          date: "2026-11-13",
          minutes: 50,
          centsPerHour: 1333,
          amount: 1111,
          note: null,
          balanceAfter: 1111,
        }),
      ),
    ),
  );

  it.effect("refuses a day after today in Paris", () =>
    story(
      Story.clock("2026-11-15T22:30:00Z"),
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2026-11-16", minutes: 60 })),
      Story.rejected(new DateInFuture({ date: "2026-11-16", today: "2026-11-15" })),
      Story.clock("2026-11-15T23:30:00Z"),
      Story.when(mariaBook, new LogShift({ date: "2026-11-16", minutes: 60 })),
      Story.then(
        mariaBook,
        new ShiftLogged({
          shiftId: "2026-11-16",
          date: "2026-11-16",
          minutes: 60,
          centsPerHour: 1500,
          amount: 1500,
          note: null,
          balanceAfter: 1500,
        }),
      ),
    ),
  );

  it.effect("refuses a day no rate covers", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2025-12-31", minutes: 60 })),
      Story.rejected(new NoRateForDate({ date: "2025-12-31" })),
    ),
  );

  it.effect("refuses an unknown or archived sitter", () =>
    story(
      sunday,
      asOwner,
      Story.when(mariaBook, new LogShift({ date: "2026-11-13", minutes: 60 })),
      Story.rejected(new UnknownSitter({ sitterId: maria })),
      Story.given(mariaBook, mariaJoined, new SitterArchived({})),
      Story.when(mariaBook, new LogShift({ date: "2026-11-13", minutes: 60 })),
      Story.rejected(new SitterNotActive({ sitterId: maria })),
    ),
  );
});

describe("CorrectShift", () => {
  it.effect("corrects the duration, re-pricing the shift and the balance", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new CorrectShift({ shiftId: "2026-11-13", minutes: 180 })),
      Story.then(
        mariaBook,
        new ShiftCorrected({
          shiftId: "2026-11-13",
          date: "2026-11-13",
          minutes: 180,
          centsPerHour: 1500,
          amount: 4500,
          previousAmount: 6000,
          note: null,
          balanceAfter: 4500,
        }),
      ),
      Story.replied({ shiftId: "2026-11-13", amount: 4500, balance: 4500 }),
      Story.view(SitterBalance, mariaBook, { balance: 4500 }),
      Story.emitted(SitterStatement, mariaBook, [
        { kind: "shift", amount: 6000, balance: 6000 },
        { kind: "shift-corrected", minutes: 180, amount: -1500, balance: 4500 },
      ]),
    ),
  );

  it.effect("re-prices a shift at a rate set after it was logged", () =>
    story(
      sunday,
      Story.given(
        mariaBook,
        mariaJoined,
        sitterRate2026,
        mariaFriday,
        new SitterRateSet({ centsPerHour: 1600, effectiveFrom: "2026-11-01" }),
      ),
      asOwner,
      Story.when(mariaBook, new CorrectShift({ shiftId: "2026-11-13", note: "new rate" })),
      Story.then(
        mariaBook,
        new ShiftCorrected({
          shiftId: "2026-11-13",
          date: "2026-11-13",
          minutes: 240,
          centsPerHour: 1600,
          amount: 6400,
          previousAmount: 6000,
          note: "new rate",
          balanceAfter: 6400,
        }),
      ),
    ),
  );

  it.effect("refuses a correction that changes nothing", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new CorrectShift({ shiftId: "2026-11-13", minutes: 240 })),
      Story.rejected(new NothingToCorrect({ shiftId: "2026-11-13" })),
    ),
  );

  it.effect("refuses an unknown, cancelled or future shift", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new CorrectShift({ shiftId: "2026-11-12", minutes: 60 })),
      Story.rejected(new UnknownShift({ shiftId: "2026-11-12" })),
      Story.when(mariaBook, new CorrectShift({ shiftId: "2026-11-13", date: "2026-11-20" })),
      Story.rejected(new DateInFuture({ date: "2026-11-20", today: "2026-11-15" })),
      Story.given(
        mariaBook,
        new ShiftCancelled({
          shiftId: "2026-11-13",
          date: "2026-11-13",
          amount: 6000,
          balanceAfter: 0,
        }),
      ),
      Story.when(mariaBook, new CorrectShift({ shiftId: "2026-11-13", minutes: 60 })),
      Story.rejected(new ShiftAlreadyCancelled({ shiftId: "2026-11-13" })),
    ),
  );
});

describe("CancelShift", () => {
  it.effect("cancels a shift, taking its amount off the balance", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new CancelShift({ shiftId: "2026-11-13" })),
      Story.then(
        mariaBook,
        new ShiftCancelled({
          shiftId: "2026-11-13",
          date: "2026-11-13",
          amount: 6000,
          balanceAfter: 0,
        }),
      ),
      Story.replied({ shiftId: "2026-11-13", balance: 0 }),
      Story.view(SitterBalance, mariaBook, { balance: 0 }),
      Story.emitted(SitterStatement, mariaBook, [
        { kind: "shift", amount: 6000 },
        { kind: "shift-cancelled", reference: "2026-11-13", amount: -6000, balance: 0 },
      ]),
      Story.when(mariaBook, new CancelShift({ shiftId: "2026-11-13" })),
      Story.rejected(new ShiftAlreadyCancelled({ shiftId: "2026-11-13" })),
    ),
  );

  it.effect("refuses an unknown sitter or shift", () =>
    story(
      sunday,
      asOwner,
      Story.when(mariaBook, new CancelShift({ shiftId: "2026-11-13" })),
      Story.rejected(new UnknownSitter({ sitterId: maria })),
      Story.given(mariaBook, mariaJoined, sitterRate2026),
      Story.when(mariaBook, new CancelShift({ shiftId: "2026-11-13" })),
      Story.rejected(new UnknownShift({ shiftId: "2026-11-13" })),
    ),
  );
});
