import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Cents, PositiveCents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { IsoDate } from "../Time.ts";
import { HOME, Household } from "./Household.ts";
import { anySignedInCaller } from "./signedIn.ts";
import { Sitter } from "./Sitter.aggregate.ts";
import { SitterId } from "./Sitter.id.ts";

const Account = Schema.Struct({
  name: Schema.String,
  iban: Schema.NullOr(Schema.String),
  balance: Cents,
  /** The first and last day babysat since the balance was last settled. */
  unpaidFrom: Schema.NullOr(IsoDate),
  unpaidTo: Schema.NullOr(IsoDate),
});
type Account = typeof Account.Type;

const Payout = Schema.Struct({
  sitterId: SitterId,
  name: Schema.String,
  iban: Schema.NullOr(Schema.String),
  amount: PositiveCents,
  reference: Schema.String,
});

const PayoutsState = Schema.Struct({
  payouts: Schema.Array(Payout),
  total: Cents,
  accounts: Schema.Record(SitterId, Account),
});
type PayoutsState = typeof PayoutsState.Type;

/** The transfer reference: what the payment is for, readable on both bank statements. */
const referenceOf = (account: Account): string => {
  if (account.unpaidFrom === null || account.unpaidTo === null) return "Babysitting";
  if (account.unpaidFrom === account.unpaidTo) return `Babysitting ${account.unpaidFrom}`;
  return `Babysitting ${account.unpaidFrom} to ${account.unpaidTo}`;
};

/** Recompute the payouts from the accounts after every change. */
const withAccounts = (accounts: PayoutsState["accounts"]): PayoutsState => {
  const payouts = (Object.entries(accounts) as Array<[SitterId, Account]>)
    .filter(([, account]) => account.balance > 0)
    .map(([sitterId, account]) => ({
      sitterId,
      name: account.name,
      iban: account.iban,
      amount: account.balance,
      reference: referenceOf(account),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return { payouts, total: payouts.reduce((sum, payout) => sum + payout.amount, 0), accounts };
};

const updated = (v: PayoutsState, sitterId: SitterId, update: (account: Account) => Account) => {
  const account = v.accounts[sitterId];
  return account ? withAccounts({ ...v.accounts, [sitterId]: update(account) }) : v;
};

/** Settled: the unpaid period starts over with the next shift. */
const settledIfZero = (account: Account): Account =>
  account.balance <= 0 ? { ...account, unpaidFrom: null, unpaidTo: null } : account;

/** What to wire to whom: every sitter owed money, with their IBAN and a transfer reference. */
export class Payouts extends Domain.View(
  "Payouts",
  {
    from: [Sitter],
    key: Household,
    keyOf: { Sitter: () => HOME },
    middleware: [Session],
    state: PayoutsState,
    initial: { payouts: [], total: 0, accounts: {} },
    evolve: {
      SitterRegistered: (v, e, { source }) =>
        withAccounts({
          ...v.accounts,
          [source.id]: {
            name: e.name,
            iban: e.iban,
            balance: 0,
            unpaidFrom: null,
            unpaidTo: null,
          },
        }),
      SitterDetailsChanged: (v, e, { source }) =>
        updated(v, source.id, (account) => ({ ...account, name: e.name, iban: e.iban })),
      ShiftLogged: (v, e, { source }) =>
        updated(v, source.id, (account) => ({
          ...account,
          balance: e.balanceAfter,
          unpaidFrom:
            account.unpaidFrom === null || e.date < account.unpaidFrom
              ? e.date
              : account.unpaidFrom,
          unpaidTo:
            account.unpaidTo === null || e.date > account.unpaidTo ? e.date : account.unpaidTo,
        })),
      ShiftCorrected: (v, e, { source }) =>
        updated(v, source.id, (account) => settledIfZero({ ...account, balance: e.balanceAfter })),
      ShiftCancelled: (v, e, { source }) =>
        updated(v, source.id, (account) => settledIfZero({ ...account, balance: e.balanceAfter })),
      PaymentRecorded: (v, e, { source }) =>
        updated(v, source.id, (account) => settledIfZero({ ...account, balance: e.balanceAfter })),
      PaymentCancelled: (v, e, { source }) =>
        updated(v, source.id, (account) => ({ ...account, balance: e.balanceAfter })),
      // Every other sitter event changes nothing here, but taking it moves the view
      // past it, so a read `atLeast` any sitter command's receipt returns.
      Sitter: (v) => v,
    },
    // 1: takes every sitter event.
    version: 1,
  },
  {
    description:
      'What to wire to whom: `payouts` lists every sitter owed money, with the amount in cents, their IBAN and a transfer reference; `total` is the sum. After wiring, record each transfer with RecordPayment. Key: always "home". The value is null until the first sitter is registered: null means nothing to wire, not an error.',
  },
) {}

export const PayoutsLive = Payouts.toLayer(anySignedInCaller);
