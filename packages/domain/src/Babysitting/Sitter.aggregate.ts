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
import { LogShift, ShiftLogged } from "./LogShift.command.ts";
import { NoRateForDate } from "./NoRateForDate.rejection.ts";
import { Rate, rateOn } from "./Rate.ts";
import { RateNotAfterLatest } from "./RateNotAfterLatest.rejection.ts";
import {
  MoreThanOwed,
  NothingOwed,
  PaymentRecorded,
  RecordPayment,
} from "./RecordPayment.command.ts";
import {
  RegisterSitter,
  SitterAlreadyRegistered,
  SitterRegistered,
} from "./RegisterSitter.command.ts";
import { SetSitterRate, SitterRateSet } from "./SetSitterRate.command.ts";
import { nextId, PaymentId, ShiftId } from "./Shift.id.ts";
import { ShiftAlreadyCancelled } from "./ShiftAlreadyCancelled.rejection.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterNotActive } from "./SitterNotActive.rejection.ts";
import { UnknownShift } from "./UnknownShift.rejection.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";
import { SitterDetailsChanged, UpdateSitter } from "./UpdateSitter.command.ts";

const Shift = Schema.Struct({
  date: IsoDate,
  minutes: Minutes,
  amount: Cents,
  note: Schema.NullOr(Schema.String),
  cancelled: Schema.Boolean,
});
type Shift = typeof Shift.Type;

const Payment = Schema.Struct({
  date: IsoDate,
  amount: PositiveCents,
  cancelled: Schema.Boolean,
});

/**
 * Everything a decision about a registered sitter needs: who they are, their
 * rate schedule (oldest first), their balance, and every shift and payment,
 * so they can be corrected or cancelled later.
 */
const Books = {
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
  rates: Schema.Array(Rate),
  balance: Cents,
  shifts: Schema.Record(ShiftId, Shift),
  payments: Schema.Record(PaymentId, Payment),
};

const SitterState = Schema.Union([
  Schema.TaggedStruct("Unregistered", {}),
  Schema.TaggedStruct("Active", Books),
  Schema.TaggedStruct("Archived", Books),
]);
type SitterState = typeof SitterState.Type;
type Registered = Exclude<SitterState, { readonly _tag: "Unregistered" }>;

// RULES

const registered = (state: SitterState, sitterId: SitterId): Registered | UnknownSitter =>
  state._tag === "Unregistered" ? new UnknownSitter({ sitterId }) : state;

const active = (
  state: SitterState,
  sitterId: SitterId,
): Registered | UnknownSitter | SitterNotActive => {
  if (state._tag === "Unregistered") return new UnknownSitter({ sitterId });
  if (state._tag === "Archived") return new SitterNotActive({ sitterId });
  return state;
};

const isRefusal = (
  value: Registered | UnknownSitter | SitterNotActive,
): value is UnknownSitter | SitterNotActive =>
  value instanceof UnknownSitter || value instanceof SitterNotActive;

const notInFuture = (
  date: string,
  now: Parameters<typeof todayAt>[0],
): DateInFuture | undefined => {
  const today = todayAt(now);
  return date > today ? new DateInFuture({ date, today }) : undefined;
};

const sameList = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

/** Who a sitter is, as recorded: what RegisterSitter and UpdateSitter reply. */
const detailsOf = (s: SitterState) =>
  s._tag === "Unregistered"
    ? { name: "", aliases: [], iban: null }
    : { name: s.name, aliases: s.aliases, iban: s.iban };

/**
 * One babysitter's book: who they are, their hourly rates, and what they are
 * owed. Every rule about money is about one sitter, so each sitter is its own
 * aggregate, keyed by their id.
 */
export class Sitter extends Domain.Aggregate("Sitter", {
  id: SitterId,
  state: SitterState,
  initial: { _tag: "Unregistered" },
  commands: [
    RegisterSitter,
    UpdateSitter,
    ArchiveSitter,
    SetSitterRate,
    LogShift,
    CorrectShift,
    CancelShift,
    RecordPayment,
    CancelPayment,
  ],
  decide: {
    RegisterSitter: (state, cmd, { id }) => {
      if (state._tag !== "Unregistered") return new SitterAlreadyRegistered({ sitterId: id });
      return [
        new SitterRegistered({
          name: cmd.name,
          aliases: cmd.aliases ?? [],
          iban: cmd.iban === undefined ? null : normalizeIban(cmd.iban),
        }),
      ];
    },

    UpdateSitter: (state, cmd, { id }) => {
      const sitter = registered(state, id);
      if (sitter instanceof UnknownSitter) return sitter;
      const name = cmd.name ?? sitter.name;
      const aliases = cmd.aliases ?? sitter.aliases;
      const iban =
        cmd.iban === undefined ? sitter.iban : cmd.iban === null ? null : normalizeIban(cmd.iban);
      if (name === sitter.name && sameList(aliases, sitter.aliases) && iban === sitter.iban) {
        return [];
      }
      return [new SitterDetailsChanged({ name, aliases, iban })];
    },

    ArchiveSitter: (state, _, { id }) => {
      const sitter = registered(state, id);
      if (sitter instanceof UnknownSitter) return sitter;
      if (sitter._tag === "Archived") return [];
      if (sitter.balance !== 0) {
        return new OutstandingBalance({ sitterId: id, balance: sitter.balance });
      }
      return [new SitterArchived({})];
    },

    SetSitterRate: (state, cmd, { id }) => {
      const sitter = active(state, id);
      if (isRefusal(sitter)) return sitter;
      const latest = sitter.rates.at(-1);
      if (latest && cmd.effectiveFrom <= latest.effectiveFrom) {
        return new RateNotAfterLatest({ latestEffectiveFrom: latest.effectiveFrom });
      }
      if (latest && latest.centsPerHour === cmd.centsPerHour) return [];
      return [
        new SitterRateSet({ centsPerHour: cmd.centsPerHour, effectiveFrom: cmd.effectiveFrom }),
      ];
    },

    LogShift: (state, cmd, { id, now }) => {
      const sitter = active(state, id);
      if (isRefusal(sitter)) return sitter;
      const future = notInFuture(cmd.date, now);
      if (future) return future;
      const rate = rateOn(sitter.rates, cmd.date);
      if (!rate) return new NoRateForDate({ date: cmd.date });
      const amount = priceOf(cmd.minutes, rate.centsPerHour);
      return [
        new ShiftLogged({
          shiftId: nextId(cmd.date, sitter.shifts),
          date: cmd.date,
          minutes: cmd.minutes,
          centsPerHour: rate.centsPerHour,
          amount,
          note: cmd.note ?? null,
          balanceAfter: sitter.balance + amount,
        }),
      ];
    },

    CorrectShift: (state, cmd, { id, now }) => {
      const sitter = active(state, id);
      if (isRefusal(sitter)) return sitter;
      const shift = sitter.shifts[cmd.shiftId];
      if (!shift) return new UnknownShift({ shiftId: cmd.shiftId });
      if (shift.cancelled) return new ShiftAlreadyCancelled({ shiftId: cmd.shiftId });
      const date = cmd.date ?? shift.date;
      const future = notInFuture(date, now);
      if (future) return future;
      const rate = rateOn(sitter.rates, date);
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

    CancelShift: (state, cmd, { id }) => {
      const sitter = active(state, id);
      if (isRefusal(sitter)) return sitter;
      const shift = sitter.shifts[cmd.shiftId];
      if (!shift) return new UnknownShift({ shiftId: cmd.shiftId });
      if (shift.cancelled) return new ShiftAlreadyCancelled({ shiftId: cmd.shiftId });
      return [
        new ShiftCancelled({
          shiftId: cmd.shiftId,
          date: shift.date,
          amount: shift.amount,
          balanceAfter: sitter.balance - shift.amount,
        }),
      ];
    },

    RecordPayment: (state, cmd, { id, now }) => {
      const sitter = registered(state, id);
      if (sitter instanceof UnknownSitter) return sitter;
      const date = cmd.date ?? todayAt(now);
      const future = notInFuture(date, now);
      if (future) return future;
      const amount = cmd.amount ?? sitter.balance;
      if (sitter.balance <= 0 || amount <= 0) {
        return new NothingOwed({ sitterId: id, balance: sitter.balance });
      }
      if (amount > sitter.balance) {
        return new MoreThanOwed({ sitterId: id, balance: sitter.balance, amount });
      }
      return [
        new PaymentRecorded({
          paymentId: nextId(`paid-${date}`, sitter.payments),
          date,
          amount,
          balanceAfter: sitter.balance - amount,
        }),
      ];
    },

    CancelPayment: (state, cmd, { id }) => {
      const sitter = active(state, id);
      if (isRefusal(sitter)) return sitter;
      const payment = sitter.payments[cmd.paymentId];
      if (!payment) return new UnknownPayment({ paymentId: cmd.paymentId });
      if (payment.cancelled) return new PaymentAlreadyCancelled({ paymentId: cmd.paymentId });
      return [
        new PaymentCancelled({
          paymentId: cmd.paymentId,
          date: payment.date,
          amount: payment.amount,
          balanceAfter: sitter.balance + payment.amount,
        }),
      ];
    },
  },

  evolve: {
    SitterRegistered: (_, e) => ({
      _tag: "Active" as const,
      name: e.name,
      aliases: e.aliases,
      iban: e.iban,
      rates: [],
      balance: 0,
      shifts: {},
      payments: {},
    }),
    SitterDetailsChanged: (s, e) =>
      withBooks(s, (books) => ({ ...books, name: e.name, aliases: e.aliases, iban: e.iban })),
    SitterArchived: (s) => (s._tag === "Active" ? { ...s, _tag: "Archived" as const } : s),
    SitterRateSet: (s, e) =>
      withBooks(s, (books) => ({
        ...books,
        rates: [...books.rates, { centsPerHour: e.centsPerHour, effectiveFrom: e.effectiveFrom }],
      })),
    ShiftLogged: (s, e) =>
      withBooks(s, (books) => ({
        ...books,
        balance: e.balanceAfter,
        shifts: {
          ...books.shifts,
          [e.shiftId]: {
            date: e.date,
            minutes: e.minutes,
            amount: e.amount,
            note: e.note,
            cancelled: false,
          },
        },
      })),
    ShiftCorrected: (s, e) =>
      withBooks(s, (books) => ({
        ...books,
        balance: e.balanceAfter,
        shifts: withEntry(books.shifts, e.shiftId, (shift) => ({
          ...shift,
          date: e.date,
          minutes: e.minutes,
          amount: e.amount,
          note: e.note,
        })),
      })),
    ShiftCancelled: (s, e) =>
      withBooks(s, (books) => ({
        ...books,
        balance: e.balanceAfter,
        shifts: withEntry(books.shifts, e.shiftId, (shift) => ({ ...shift, cancelled: true })),
      })),
    PaymentRecorded: (s, e) =>
      withBooks(s, (books) => ({
        ...books,
        balance: e.balanceAfter,
        payments: {
          ...books.payments,
          [e.paymentId]: { date: e.date, amount: e.amount, cancelled: false },
        },
      })),
    PaymentCancelled: (s, e) =>
      withBooks(s, (books) => ({
        ...books,
        balance: e.balanceAfter,
        payments: withEntry(books.payments, e.paymentId, (payment) => ({
          ...payment,
          cancelled: true,
        })),
      })),
  },

  reply: {
    RegisterSitter: detailsOf,
    UpdateSitter: detailsOf,
    ArchiveSitter: (s) => ({
      name: s._tag === "Unregistered" ? "" : s.name,
      active: s._tag === "Active",
    }),
    SetSitterRate: (s) => {
      const latest = s._tag === "Unregistered" ? undefined : s.rates.at(-1);
      return {
        centsPerHour: latest?.centsPerHour ?? 1,
        effectiveFrom: latest?.effectiveFrom ?? "1970-01-01",
      };
    },
    LogShift: (s, events) => {
      const logged = events.find((e) => e._tag === "ShiftLogged");
      if (!logged) return emptyLogReply;
      const shifts: Readonly<Record<string, Shift>> = s._tag === "Unregistered" ? {} : s.shifts;
      const otherShiftsThatDay = Object.entries(shifts).filter(
        ([shiftId, shift]) =>
          shiftId !== logged.shiftId && shift.date === logged.date && !shift.cancelled,
      ).length;
      return {
        shiftId: logged.shiftId,
        date: logged.date,
        minutes: logged.minutes,
        centsPerHour: logged.centsPerHour,
        amount: logged.amount,
        balance: logged.balanceAfter,
        otherShiftsThatDay,
      };
    },
    CorrectShift: (_, events) => {
      const corrected = events.find((e) => e._tag === "ShiftCorrected");
      return corrected
        ? { shiftId: corrected.shiftId, amount: corrected.amount, balance: corrected.balanceAfter }
        : { shiftId: "", amount: 0, balance: 0 };
    },
    CancelShift: (_, events) => {
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

/** Apply `update` to a registered sitter's book, keeping whether they are active. */
const withBooks = (s: SitterState, update: (books: Registered) => Registered): SitterState =>
  s._tag === "Unregistered" ? s : { ...update(s), _tag: s._tag };
