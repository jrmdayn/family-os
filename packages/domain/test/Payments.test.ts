import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import {
  CancelPayment,
  PaymentAlreadyCancelled,
  PaymentCancelled,
  UnknownPayment,
} from "../src/Babysitting/CancelPayment.command.ts";
import { DateInFuture } from "../src/Babysitting/DateInFuture.rejection.ts";
import { HOME } from "../src/Babysitting/Household.ts";
import { ShiftLogged } from "../src/Babysitting/LogShift.command.ts";
import { Payouts } from "../src/Babysitting/Payouts.view.ts";
import {
  MoreThanOwed,
  NothingOwed,
  PaymentRecorded,
  RecordPayment,
} from "../src/Babysitting/RecordPayment.command.ts";
import { SitterBalance } from "../src/Babysitting/SitterBalance.view.ts";
import { SitterStatement } from "../src/Babysitting/SitterStatement.view.ts";
import { UnknownSitter } from "../src/Babysitting/UnknownSitter.rejection.ts";
import {
  ana,
  anaBook,
  ANA_IBAN,
  anaJoined,
  asOwner,
  maria,
  mariaBook,
  MARIA_IBAN,
  mariaFriday,
  mariaJoined,
  sitterRate2026,
  story,
  sunday,
} from "./fixtures.ts";

const mariaMonday = new ShiftLogged({
  shiftId: "2026-11-09",
  date: "2026-11-09",
  minutes: 120,
  centsPerHour: 1500,
  amount: 3000,
  note: null,
  balanceAfter: 9000,
});

const anaWednesday = new ShiftLogged({
  shiftId: "2026-11-11",
  date: "2026-11-11",
  minutes: 180,
  centsPerHour: 1500,
  amount: 4500,
  note: null,
  balanceAfter: 4500,
});

const paidMaria = new PaymentRecorded({
  paymentId: "paid-2026-11-15",
  date: "2026-11-15",
  amount: 6000,
  balanceAfter: 0,
});

describe("Payouts", () => {
  it.effect("lists what to wire to whom, with IBANs and a reference for the unpaid days", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday, mariaMonday),
      Story.given(anaBook, anaJoined, sitterRate2026, anaWednesday),
      Story.view(Payouts, HOME, {
        payouts: [
          {
            sitterId: ana,
            name: "Ana",
            iban: ANA_IBAN,
            amount: 4500,
            reference: "Babysitting 2026-11-11",
          },
          {
            sitterId: maria,
            name: "Maria",
            iban: MARIA_IBAN,
            amount: 9000,
            reference: "Babysitting 2026-11-09 to 2026-11-13",
          },
        ],
        total: 13500,
      }),
    ),
  );

  it.effect("drops a sitter once paid, and starts their next period afresh", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday, paidMaria),
      Story.view(Payouts, HOME, { payouts: [], total: 0 }),
      Story.given(
        mariaBook,
        new ShiftLogged({
          shiftId: "2026-11-15",
          date: "2026-11-15",
          minutes: 60,
          centsPerHour: 1500,
          amount: 1500,
          note: null,
          balanceAfter: 1500,
        }),
      ),
      Story.view(Payouts, HOME, (payouts) => {
        const [payout] = payouts.payouts;
        if (payout?.reference !== "Babysitting 2026-11-15" || payout.amount !== 1500) {
          throw new Error(`unexpected payout ${JSON.stringify(payout)}`);
        }
      }),
    ),
  );
});

describe("RecordPayment", () => {
  it.effect("pays the whole balance today by default", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new RecordPayment()),
      Story.then(mariaBook, paidMaria),
      Story.replied({ paymentId: "paid-2026-11-15", amount: 6000, balance: 0 }),
      Story.view(SitterBalance, mariaBook, {
        balance: 0,
        lastPayment: { date: "2026-11-15", amount: 6000 },
      }),
      Story.emitted(SitterStatement, mariaBook, [
        { kind: "shift", amount: 6000, balance: 6000 },
        { kind: "payment", reference: "paid-2026-11-15", amount: -6000, balance: 0 },
      ]),
    ),
  );

  it.effect("records a partial payment on a given day", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new RecordPayment({ amount: 2000, date: "2026-11-14" })),
      Story.then(
        mariaBook,
        new PaymentRecorded({
          paymentId: "paid-2026-11-14",
          date: "2026-11-14",
          amount: 2000,
          balanceAfter: 4000,
        }),
      ),
      Story.view(Payouts, HOME, (payouts) => {
        if (payouts.payouts[0]?.amount !== 4000) throw new Error("Maria should still be owed 4000");
      }),
      Story.when(mariaBook, new RecordPayment()),
      Story.then(
        mariaBook,
        new PaymentRecorded({
          paymentId: "paid-2026-11-15",
          date: "2026-11-15",
          amount: 4000,
          balanceAfter: 0,
        }),
      ),
    ),
  );

  it.effect("refuses to pay more than is owed, or when nothing is", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      Story.given(anaBook, anaJoined, sitterRate2026),
      asOwner,
      Story.when(mariaBook, new RecordPayment({ amount: 7000 })),
      Story.rejected(new MoreThanOwed({ sitterId: maria, balance: 6000, amount: 7000 })),
      Story.when(anaBook, new RecordPayment()),
      Story.rejected(new NothingOwed({ sitterId: ana, balance: 0 })),
    ),
  );

  it.effect("refuses an unknown sitter or a future date", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(anaBook, new RecordPayment()),
      Story.rejected(new UnknownSitter({ sitterId: ana })),
      Story.when(mariaBook, new RecordPayment({ date: "2026-11-16" })),
      Story.rejected(new DateInFuture({ date: "2026-11-16", today: "2026-11-15" })),
    ),
  );
});

describe("CancelPayment", () => {
  it.effect("cancels a payment: its amount is owed again", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday, paidMaria),
      asOwner,
      Story.when(mariaBook, new CancelPayment({ paymentId: "paid-2026-11-15" })),
      Story.then(
        mariaBook,
        new PaymentCancelled({
          paymentId: "paid-2026-11-15",
          date: "2026-11-15",
          amount: 6000,
          balanceAfter: 6000,
        }),
      ),
      Story.replied({ paymentId: "paid-2026-11-15", balance: 6000 }),
      Story.view(SitterBalance, mariaBook, { balance: 6000 }),
      Story.view(Payouts, HOME, (payouts) => {
        if (payouts.total !== 6000) throw new Error("Maria should be owed 6000 again");
      }),
      Story.when(mariaBook, new CancelPayment({ paymentId: "paid-2026-11-15" })),
      Story.rejected(new PaymentAlreadyCancelled({ paymentId: "paid-2026-11-15" })),
    ),
  );

  it.effect("refuses an unknown payment", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      asOwner,
      Story.when(mariaBook, new CancelPayment({ paymentId: "paid-2026-11-15" })),
      Story.rejected(new UnknownPayment({ paymentId: "paid-2026-11-15" })),
    ),
  );
});
