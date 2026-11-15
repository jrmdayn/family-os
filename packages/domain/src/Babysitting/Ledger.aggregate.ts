import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents, priceOf } from "../Money.ts";
import { IsoDate, Minutes, todayAt } from "../Time.ts";
import { ArchiveSitter, OutstandingBalance, SitterArchived } from "./ArchiveSitter.command.ts";
import {
  CancelPayment,
  PaymentAlreadyCancelled,
  PaymentCancelled,
  UnknownPayment,
} from "./CancelPayment.command.ts";
import { CancelShift, ShiftCancelled } from "./CancelShift.command.ts";
import { CorrectShift, NothingToCorrect, ShiftCorrected } from "./CorrectShift.command.ts";
import { DateInFuture } from "./DateInFuture.rejection.ts";
import { normalizeIban } from "./Iban.ts";
import { LedgerId } from "./Ledger.id.ts";
import { LogShift, ShiftLogged } from "./LogShift.command.ts";
import { NameTaken } from "./NameTaken.rejection.ts";
import { NoRateForDate } from "./NoRateForDate.rejection.ts";
import {
  MoreThanOwed,
  NothingOwed,
  PaymentRecorded,
  RecordPayment,
} from "./RecordPayment.command.ts";
import { RegisterSitter, SitterRegistered, UnusableName } from "./RegisterSitter.command.ts";
import { HourlyRateSet, RateNotAfterLatest, SetHourlyRate } from "./SetHourlyRate.command.ts";
import { nextId, PaymentId, ShiftId } from "./Shift.id.ts";
import { ShiftAlreadyCancelled } from "./ShiftAlreadyCancelled.rejection.ts";
import { SitterId, slugOf } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownShift } from "./UnknownShift.rejection.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";
import { SitterDetailsChanged, UpdateSitter } from "./UpdateSitter.command.ts";

const Rate = Schema.Struct({ centsPerHour: PositiveCents, effectiveFrom: IsoDate });

const Sitter = Schema.Struct({
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
  balance: Cents,
});
type Sitter = typeof Sitter.Type;

const Shift = Schema.Struct({
  sitterId: SitterId,
  date: IsoDate,
  minutes: Minutes,
  amount: Cents,
  note: Schema.NullOr(Schema.String),
  cancelled: Schema.Boolean,
});
type Shift = typeof Shift.Type;

const Payment = Schema.Struct({
  sitterId: SitterId,
  date: IsoDate,
  amount: PositiveCents,
  cancelled: Schema.Boolean,
});

/**
 * Everything a ledger decision needs: the rate schedule (oldest first), the
 * sitters with their balances, and every shift and payment, so they can be
 * corrected or cancelled later.
 */
const LedgerState = Schema.Struct({
  rates: Schema.Array(Rate),
  sitters: Schema.Record(SitterId, Sitter),
  shifts: Schema.Record(ShiftId, Shift),
  payments: Schema.Record(PaymentId, Payment),
});
type LedgerState = typeof LedgerState.Type;

// RULES

/** The rate in force on `date`: the latest one that took effect on or before it. */
const rateOn = (state: LedgerState, date: string) =>
  state.rates.findLast((rate) => rate.effectiveFrom <= date);

const sitterFor = (state: LedgerState, sitterId: SitterId): Sitter | UnknownSitter =>
  state.sitters[sitterId] ?? new UnknownSitter({ sitterId });

const activeSitterFor = (
  state: LedgerState,
  sitterId: SitterId,
): Sitter | UnknownSitter | SitterNotActive => {
  const sitter = sitterFor(state, sitterId);
  if (sitter instanceof UnknownSitter) return sitter;
  return sitter.active ? sitter : new SitterNotActive({ sitterId });
};

/** The sitter a recorded shift or payment belongs to, if they are still active. */
const activeOwnerOf = (state: LedgerState, sitterId: SitterId): Sitter | SitterNotActive => {
  const sitter = state.sitters[sitterId];
  return sitter?.active ? sitter : new SitterNotActive({ sitterId });
};

const notInFuture = (
  date: string,
  now: Parameters<typeof todayAt>[0],
): DateInFuture | undefined => {
  const today = todayAt(now);
  return date > today ? new DateInFuture({ date, today }) : undefined;
};

const sameName = (a: string, b: string) => a.localeCompare(b, "fr", { sensitivity: "base" }) === 0;

/** The first of `names` another sitter (not `self`) already goes by. */
const nameTaken = (
  state: LedgerState,
  names: ReadonlyArray<string>,
  self?: SitterId,
): NameTaken | undefined => {
  for (const [sitterId, sitter] of Object.entries(state.sitters) as Array<[SitterId, Sitter]>) {
    if (sitterId === self) continue;
    const taken = names.find(
      (name) =>
        sameName(name, sitter.name) ||
        sitter.aliases.some((alias) => sameName(name, alias)) ||
        slugOf(name) === sitterId,
    );
    if (taken !== undefined) return new NameTaken({ name: taken, takenBy: sitterId });
  }
  return undefined;
};

const sameList = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** The household's babysitting ledger: the hourly rate, the sitters, and what each is owed. */
export class Ledger extends Domain.Aggregate("Ledger", {
  id: LedgerId,
  state: LedgerState,
  initial: { rates: [], sitters: {}, shifts: {}, payments: {} },
  commands: [
    SetHourlyRate,
    RegisterSitter,
    UpdateSitter,
    ArchiveSitter,
    LogShift,
    CorrectShift,
    CancelShift,
    RecordPayment,
    CancelPayment,
  ],
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

    RegisterSitter: (state, cmd) => {
      const slug = slugOf(cmd.name);
      if (slug === "") return new UnusableName({ name: cmd.name });
      const sitterId = SitterId.make(slug);
      const aliases = cmd.aliases ?? [];
      const taken = nameTaken(state, [cmd.name, ...aliases]);
      if (taken) return taken;
      return [
        new SitterRegistered({
          sitterId,
          name: cmd.name,
          aliases,
          iban: cmd.iban === undefined ? null : normalizeIban(cmd.iban),
        }),
      ];
    },

    UpdateSitter: (state, cmd) => {
      const sitter = sitterFor(state, cmd.sitterId);
      if (sitter instanceof UnknownSitter) return sitter;
      const name = cmd.name ?? sitter.name;
      const aliases = cmd.aliases ?? sitter.aliases;
      const iban =
        cmd.iban === undefined ? sitter.iban : cmd.iban === null ? null : normalizeIban(cmd.iban);
      const taken = nameTaken(state, [name, ...aliases], cmd.sitterId);
      if (taken) return taken;
      if (name === sitter.name && sameList(aliases, sitter.aliases) && iban === sitter.iban) {
        return [];
      }
      return [new SitterDetailsChanged({ sitterId: cmd.sitterId, name, aliases, iban })];
    },

    ArchiveSitter: (state, cmd) => {
      const sitter = sitterFor(state, cmd.sitterId);
      if (sitter instanceof UnknownSitter) return sitter;
      if (!sitter.active) return [];
      if (sitter.balance !== 0) {
        return new OutstandingBalance({ sitterId: cmd.sitterId, balance: sitter.balance });
      }
      return [new SitterArchived({ sitterId: cmd.sitterId })];
    },

    LogShift: (state, cmd, { now }) => {
      const sitter = activeSitterFor(state, cmd.sitterId);
      if (!("balance" in sitter)) return sitter;
      const future = notInFuture(cmd.date, now);
      if (future) return future;
      const rate = rateOn(state, cmd.date);
      if (!rate) return new NoRateForDate({ date: cmd.date });
      const amount = priceOf(cmd.minutes, rate.centsPerHour);
      return [
        new ShiftLogged({
          shiftId: nextId(`${cmd.sitterId}-${cmd.date}`, state.shifts),
          sitterId: cmd.sitterId,
          date: cmd.date,
          minutes: cmd.minutes,
          centsPerHour: rate.centsPerHour,
          amount,
          note: cmd.note ?? null,
          balanceAfter: sitter.balance + amount,
        }),
      ];
    },

    CorrectShift: (state, cmd, { now }) => {
      const shift = state.shifts[cmd.shiftId];
      if (!shift) return new UnknownShift({ shiftId: cmd.shiftId });
      if (shift.cancelled) return new ShiftAlreadyCancelled({ shiftId: cmd.shiftId });
      const sitter = activeOwnerOf(state, shift.sitterId);
      if (sitter instanceof SitterNotActive) return sitter;
      const date = cmd.date ?? shift.date;
      const future = notInFuture(date, now);
      if (future) return future;
      const rate = rateOn(state, date);
      if (!rate) return new NoRateForDate({ date });
      const minutes = cmd.minutes ?? shift.minutes;
      const note = cmd.note === undefined ? shift.note : cmd.note;
      const amount = priceOf(minutes, rate.centsPerHour);
      if (
        date === shift.date &&
        minutes === shift.minutes &&
        note === shift.note &&
        amount === shift.amount
      ) {
        return new NothingToCorrect({ shiftId: cmd.shiftId });
      }
      return [
        new ShiftCorrected({
          shiftId: cmd.shiftId,
          sitterId: shift.sitterId,
          date,
          minutes,
          centsPerHour: rate.centsPerHour,
          amount,
          previousAmount: shift.amount,
          note,
          balanceAfter: sitter.balance - shift.amount + amount,
        }),
      ];
    },

    CancelShift: (state, cmd) => {
      const shift = state.shifts[cmd.shiftId];
      if (!shift) return new UnknownShift({ shiftId: cmd.shiftId });
      if (shift.cancelled) return new ShiftAlreadyCancelled({ shiftId: cmd.shiftId });
      const sitter = activeOwnerOf(state, shift.sitterId);
      if (sitter instanceof SitterNotActive) return sitter;
      return [
        new ShiftCancelled({
          shiftId: cmd.shiftId,
          sitterId: shift.sitterId,
          date: shift.date,
          amount: shift.amount,
          balanceAfter: sitter.balance - shift.amount,
        }),
      ];
    },

    RecordPayment: (state, cmd, { now }) => {
      const sitter = sitterFor(state, cmd.sitterId);
      if (sitter instanceof UnknownSitter) return sitter;
      const date = cmd.date ?? todayAt(now);
      const future = notInFuture(date, now);
      if (future) return future;
      const amount = cmd.amount ?? sitter.balance;
      if (sitter.balance <= 0 || amount <= 0) {
        return new NothingOwed({ sitterId: cmd.sitterId, balance: sitter.balance });
      }
      if (amount > sitter.balance) {
        return new MoreThanOwed({ sitterId: cmd.sitterId, balance: sitter.balance, amount });
      }
      return [
        new PaymentRecorded({
          paymentId: nextId(`${cmd.sitterId}-paid-${date}`, state.payments),
          sitterId: cmd.sitterId,
          date,
          amount,
          balanceAfter: sitter.balance - amount,
        }),
      ];
    },

    CancelPayment: (state, cmd) => {
      const payment = state.payments[cmd.paymentId];
      if (!payment) return new UnknownPayment({ paymentId: cmd.paymentId });
      if (payment.cancelled) return new PaymentAlreadyCancelled({ paymentId: cmd.paymentId });
      const sitter = activeOwnerOf(state, payment.sitterId);
      if (sitter instanceof SitterNotActive) return sitter;
      return [
        new PaymentCancelled({
          paymentId: cmd.paymentId,
          sitterId: payment.sitterId,
          date: payment.date,
          amount: payment.amount,
          balanceAfter: sitter.balance + payment.amount,
        }),
      ];
    },
  },

  evolve: {
    HourlyRateSet: (s, e) => ({
      ...s,
      rates: [...s.rates, { centsPerHour: e.centsPerHour, effectiveFrom: e.effectiveFrom }],
    }),
    SitterRegistered: (s, e) => ({
      ...s,
      sitters: {
        ...s.sitters,
        [e.sitterId]: { name: e.name, aliases: e.aliases, iban: e.iban, active: true, balance: 0 },
      },
    }),
    SitterDetailsChanged: (s, e) =>
      withSitter(s, e.sitterId, (sitter) => ({
        ...sitter,
        name: e.name,
        aliases: e.aliases,
        iban: e.iban,
      })),
    SitterArchived: (s, e) => withSitter(s, e.sitterId, (sitter) => ({ ...sitter, active: false })),
    ShiftLogged: (s, e) => ({
      ...withBalance(s, e.sitterId, e.balanceAfter),
      shifts: {
        ...s.shifts,
        [e.shiftId]: {
          sitterId: e.sitterId,
          date: e.date,
          minutes: e.minutes,
          amount: e.amount,
          note: e.note,
          cancelled: false,
        },
      },
    }),
    ShiftCorrected: (s, e) => ({
      ...withBalance(s, e.sitterId, e.balanceAfter),
      shifts: withEntry(s.shifts, e.shiftId, (shift) => ({
        ...shift,
        date: e.date,
        minutes: e.minutes,
        amount: e.amount,
        note: e.note,
      })),
    }),
    ShiftCancelled: (s, e) => ({
      ...withBalance(s, e.sitterId, e.balanceAfter),
      shifts: withEntry(s.shifts, e.shiftId, (shift) => ({ ...shift, cancelled: true })),
    }),
    PaymentRecorded: (s, e) => ({
      ...withBalance(s, e.sitterId, e.balanceAfter),
      payments: {
        ...s.payments,
        [e.paymentId]: { sitterId: e.sitterId, date: e.date, amount: e.amount, cancelled: false },
      },
    }),
    PaymentCancelled: (s, e) => ({
      ...withBalance(s, e.sitterId, e.balanceAfter),
      payments: withEntry(s.payments, e.paymentId, (payment) => ({ ...payment, cancelled: true })),
    }),
  },

  reply: {
    SetHourlyRate: (s) => {
      const latest = s.rates.at(-1);
      return {
        centsPerHour: latest?.centsPerHour ?? 1,
        effectiveFrom: latest?.effectiveFrom ?? "",
      };
    },
    RegisterSitter: (_, events) => {
      const registered = events.find((e) => e._tag === "SitterRegistered");
      return { sitterId: registered?.sitterId ?? SitterId.make("unknown") };
    },
    LogShift: (s, events) => {
      const logged = events.find((e) => e._tag === "ShiftLogged");
      if (!logged) return emptyLogReply;
      const otherShiftsThatDay = Object.entries(s.shifts).filter(
        ([shiftId, shift]: [string, Shift]) =>
          shiftId !== logged.shiftId &&
          shift.sitterId === logged.sitterId &&
          shift.date === logged.date &&
          !shift.cancelled,
      ).length;
      return {
        shiftId: logged.shiftId,
        sitterId: logged.sitterId,
        date: logged.date,
        minutes: logged.minutes,
        centsPerHour: logged.centsPerHour,
        amount: logged.amount,
        balance: logged.balanceAfter,
        otherShiftsThatDay,
      };
    },
    CorrectShift: (s, events) => {
      const corrected = events.find((e) => e._tag === "ShiftCorrected");
      return corrected
        ? { shiftId: corrected.shiftId, amount: corrected.amount, balance: corrected.balanceAfter }
        : { shiftId: "", amount: 0, balance: 0 };
    },
    CancelShift: (s, events) => {
      const cancelled = events.find((e) => e._tag === "ShiftCancelled");
      return cancelled
        ? { shiftId: cancelled.shiftId, balance: cancelled.balanceAfter }
        : { shiftId: "", balance: 0 };
    },
    RecordPayment: (_, events) => {
      const paid = events.find((e) => e._tag === "PaymentRecorded");
      return paid
        ? { paymentId: paid.paymentId, amount: paid.amount, balance: paid.balanceAfter }
        : { paymentId: "", amount: 1, balance: 0 };
    },
    CancelPayment: (_, events) => {
      const cancelled = events.find((e) => e._tag === "PaymentCancelled");
      return cancelled
        ? { paymentId: cancelled.paymentId, balance: cancelled.balanceAfter }
        : { paymentId: "", balance: 0 };
    },
  },
}) {}

// HELPERS

const emptyLogReply = {
  shiftId: "",
  sitterId: SitterId.make("unknown"),
  date: "1970-01-01",
  minutes: 1,
  centsPerHour: 1,
  amount: 0,
  balance: 0,
  otherShiftsThatDay: 0,
};

const withEntry = <K extends string, V>(
  record: Readonly<Record<K, V>>,
  key: K,
  update: (value: V) => V,
): Readonly<Record<K, V>> => {
  const value = record[key];
  return value === undefined ? record : { ...record, [key]: update(value) };
};

const withSitter = (s: LedgerState, sitterId: SitterId, update: (sitter: Sitter) => Sitter) => ({
  ...s,
  sitters: withEntry(s.sitters, sitterId, update),
});

const withBalance = (s: LedgerState, sitterId: SitterId, balance: number) =>
  withSitter(s, sitterId, (sitter) => ({ ...sitter, balance }));
