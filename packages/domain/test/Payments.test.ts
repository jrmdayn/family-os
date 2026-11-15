import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import {
  CancelPayment,
  PaymentAlreadyCancelled,
  PaymentCancelled,
  UnknownPayment,
} from "../src/Babysitting/CancelPayment.command.ts";
import { DateInFuture } from "../src/Babysitting/DateInFuture.rejection.ts";
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
  ANA_IBAN,
  anaJoined,
  asOwner,
  home,
  maria,
  MARIA_IBAN,
  mariaFriday,
  mariaJoined,
  rate2026,
  story,
  sunday,
} from "./fixtures.ts";

const mariaMonday = new ShiftLogged({
  shiftId: "maria-2026-11-09",
  sitterId: maria,
  date: "2026-11-09",
  minutes: 120,
  centsPerHour: 1500,
  amount: 3000,
  note: null,
  balanceAfter: 9000,
});

const anaWednesday = new ShiftLogged({
  shiftId: "ana-2026-11-11",
  sitterId: ana,
  date: "2026-11-11",
  minutes: 180,
  centsPerHour: 1500,
  amount: 4500,
  note: null,
  balanceAfter: 4500,
});

const paidMaria = new PaymentRecorded({
  paymentId: "maria-paid-2026-11-15",
  sitterId: maria,
  date: "2026-11-15",
  amount: 6000,
  balanceAfter: 0,
});

describe("Payouts", () => {
  it.effect("lists what to wire to whom, with IBANs and a reference for the unpaid days", () =>
    story(
      sunday,
      Story.given(home, rate2026, mariaJoined, anaJoined, mariaFriday, mariaMonday, anaWednesday),
      Story.view(Payouts, home, {
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
      Story.given(home, rate2026, mariaJoined, mariaFriday, paidMaria),
      Story.view(Payouts, home, { payouts: [], total: 0 }),
      Story.given(
        home,
        new ShiftLogged({
          shiftId: "maria-2026-11-15",
          sitterId: maria,
          date: "2026-11-15",
          minutes: 60,
          centsPerHour: 1500,
          amount: 1500,
          note: null,
          balanceAfter: 1500,
        }),
      ),
      Story.view(Payouts, home, (payouts) => {
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
      Story.given(home, rate2026, mariaJoined, mariaFriday),
      asOwner,
      Story.when(home, new RecordPayment({ sitterId: maria })),
      Story.then(home, paidMaria),
      Story.replied({ paymentId: "maria-paid-2026-11-15", amount: 6000, balance: 0 }),
      Story.view(SitterBalance, maria, {
        balance: 0,
        lastPayment: { date: "2026-11-15", amount: 6000 },
      }),
      Story.emitted(SitterStatement, maria, [
        { kind: "shift", amount: 6000, balance: 6000 },
        { kind: "payment", reference: "maria-paid-2026-11-15", amount: -6000, balance: 0 },
      ]),
    ),
  );

  it.effect("records a partial payment on a given day", () =>
    story(
      sunday,
      Story.given(home, rate2026, mariaJoined, mariaFriday),
      asOwner,
      Story.when(home, new RecordPayment({ sitterId: maria, amount: 2000, date: "2026-11-14" })),
      Story.then(
        home,
        new PaymentRecorded({
          paymentId: "maria-paid-2026-11-14",
          sitterId: maria,
          date: "2026-11-14",
          amount: 2000,
          balanceAfter: 4000,
        }),
      ),
      Story.view(Payouts, home, (payouts) => {
        if (payouts.payouts[0]?.amount !== 4000) throw new Error("Maria should still be owed 4000");
      }),
      Story.when(home, new RecordPayment({ sitterId: maria })),
      Story.then(
        home,
        new PaymentRecorded({
          paymentId: "maria-paid-2026-11-15",
          sitterId: maria,
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
      Story.given(home, rate2026, mariaJoined, anaJoined, mariaFriday),
      asOwner,
      Story.when(home, new RecordPayment({ sitterId: maria, amount: 7000 })),
      Story.rejected(new MoreThanOwed({ sitterId: maria, balance: 6000, amount: 7000 })),
      Story.when(home, new RecordPayment({ sitterId: ana })),
      Story.rejected(new NothingOwed({ sitterId: ana, balance: 0 })),
    ),
  );

  it.effect("refuses an unknown sitter or a future date", () =>
    story(
      sunday,
      Story.given(home, rate2026, mariaJoined, mariaFriday),
      asOwner,
      Story.when(home, new RecordPayment({ sitterId: ana })),
      Story.rejected(new UnknownSitter({ sitterId: ana })),
      Story.when(home, new RecordPayment({ sitterId: maria, date: "2026-11-16" })),
      Story.rejected(new DateInFuture({ date: "2026-11-16", today: "2026-11-15" })),
    ),
  );
});

describe("CancelPayment", () => {
  it.effect("cancels a payment: its amount is owed again", () =>
    story(
      sunday,
      Story.given(home, rate2026, mariaJoined, mariaFriday, paidMaria),
      asOwner,
      Story.when(home, new CancelPayment({ paymentId: "maria-paid-2026-11-15" })),
      Story.then(
        home,
        new PaymentCancelled({
          paymentId: "maria-paid-2026-11-15",
          sitterId: maria,
          date: "2026-11-15",
          amount: 6000,
          balanceAfter: 6000,
        }),
      ),
      Story.replied({ paymentId: "maria-paid-2026-11-15", balance: 6000 }),
      Story.view(SitterBalance, maria, { balance: 6000 }),
      Story.view(Payouts, home, (payouts) => {
        if (payouts.total !== 6000) throw new Error("Maria should be owed 6000 again");
      }),
      Story.when(home, new CancelPayment({ paymentId: "maria-paid-2026-11-15" })),
      Story.rejected(new PaymentAlreadyCancelled({ paymentId: "maria-paid-2026-11-15" })),
    ),
  );

  it.effect("refuses an unknown payment", () =>
    story(
      sunday,
      asOwner,
      Story.when(home, new CancelPayment({ paymentId: "maria-paid-2026-11-15" })),
      Story.rejected(new UnknownPayment({ paymentId: "maria-paid-2026-11-15" })),
    ),
  );
});
