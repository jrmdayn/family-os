---
title: The babysitting model
description: The words, rules, commands and views of the babysitting ledger, and how "Maria 4h on Friday" becomes a recorded shift.
---

The babysitting ledger lives in `packages/domain/src/Babysitting/`. It is an Alchemy Domain model: commands ask for a change, an aggregate decides, events record what happened, policies react to them, and views answer questions.

## Glossary

| Word | Meaning |
|---|---|
| **Sitter** | Someone who babysits, and their book: who they are, their rates, their shifts and payments. Identified by a slug chosen when they are registered (`maria`, `ana-lucia`). Has a name, nicknames and an IBAN. |
| **Rate card** | The household's hourly rate schedule, with the id `home`. What every sitter is paid unless they have their own rate. |
| **Rate** | An hourly rate in cents, from an `effectiveFrom` date until the next rate. Each sitter has their own rate schedule; the rate card's rates are copied into it. |
| **Shift** | A sitter babysat on a day for some minutes. Priced when logged, at the sitter's rate of that day: `amount = round(minutes × rate / 60)`. Id, within the sitter: `2026-11-13` (`-2`, `-3` for more shifts that day). |
| **Payment** | Money wired to a sitter. Id, within the sitter: `paid-2026-11-15`. |
| **Balance** | What you owe a sitter: their shifts minus their payments. Negative means they owe you. |
| **Payout** | A line of "what to wire to whom": a sitter with a positive balance, their IBAN and a transfer reference. |
| **Archived** | A sitter who no longer babysits. Their book is closed with a zero balance; their history stays readable, and rate changes no longer reach them. |
| **Shared name** | A name or nickname more than one active sitter goes by. Names aren't unique, so a lookup by a shared name asks which sitter was meant. |

Units are fixed everywhere: money in **euro cents**, durations in **minutes**, dates as **`YYYY-MM-DD` in Europe/Paris**.

## Aggregates: one per sitter, and the rate card

Each sitter is a `Sitter` aggregate (`Sitter.aggregate.ts`), keyed by their id. Its state is a lifecycle, `Unregistered`, `Active` or `Archived`, and once registered it holds the sitter's details, their rate schedule, their balance, and every shift and payment.

Every rule about money is about one sitter: a shift adds to their balance, a payment can't exceed it, archiving needs it at zero. So each sitter is its own consistency boundary.

Pricing a shift needs the rate of its day, and a decision reads only its own aggregate's state. So each sitter keeps their own copy of the rates. The household's rate lives in the `RateCard` aggregate (`RateCard.aggregate.ts`, id `home`), and two policies copy it to the sitters:

- **`HourlyRateRollout`**: when the household rate changes (`HourlyRateSet`), it sends `SetSitterRate` to every active sitter listed in `SitterDirectory`. A sitter whose own rate already starts on or after that date keeps it (the command is refused with `RateNotAfterLatest`, which the policy ignores).
- **`HourlyRateOnboarding`**: when a sitter registers (`SitterRegistered`), it reads the rate card and sends them every household rate, oldest first, so shifts from before they joined can be priced too.

Both run again safely: a rate a sitter already has is refused as `RateNotAfterLatest`. Policies run just after the event commits, so a rate reaches the sitters a moment after `SetHourlyRate` replies. See [Decisions](/decisions/) for this trade-off.

## Commands

Every command requires a session. `SetHourlyRate` targets the rate card, `home`; every other command targets a sitter's id.

| Command | Target | Input | Records | Refused with |
|---|---|---|---|---|
| `SetHourlyRate` | `home` | `centsPerHour`, `effectiveFrom` | `HourlyRateSet` (nothing if the rate is unchanged), then `SitterRateSet` on each active sitter | `RateNotAfterLatest` |
| `SetSitterRate` | sitter | `centsPerHour`, `effectiveFrom` | `SitterRateSet` (nothing if the rate is unchanged) | `UnknownSitter`, `SitterNotActive`, `RateNotAfterLatest` |
| `RegisterSitter` | new sitter id | `name`, `aliases?`, `iban?` | `SitterRegistered`, then a `SitterRateSet` per household rate | `SitterAlreadyRegistered` |
| `UpdateSitter` | sitter | `name?`, `aliases?`, `iban?` (null removes it) | `SitterDetailsChanged` (nothing if unchanged) | `UnknownSitter` |
| `ArchiveSitter` | sitter | | `SitterArchived` (nothing if already archived) | `UnknownSitter`, `OutstandingBalance` |
| `LogShift` | sitter | `date`, `minutes`, `note?` | `ShiftLogged` with rate, amount and balance after | `UnknownSitter`, `SitterNotActive`, `NoRateForDate`, `DateInFuture` |
| `CorrectShift` | sitter | `shiftId`, `date?`, `minutes?`, `note?` | `ShiftCorrected`, re-priced at the sitter's rate of its date | `UnknownSitter`, `UnknownShift`, `ShiftAlreadyCancelled`, `NothingToCorrect`, `SitterNotActive`, `NoRateForDate`, `DateInFuture` |
| `CancelShift` | sitter | `shiftId` | `ShiftCancelled` | `UnknownSitter`, `UnknownShift`, `ShiftAlreadyCancelled`, `SitterNotActive` |
| `RecordPayment` | sitter | `amount?` (whole balance), `date?` (today) | `PaymentRecorded` | `UnknownSitter`, `NothingOwed`, `MoreThanOwed`, `DateInFuture` |
| `CancelPayment` | sitter | `paymentId` | `PaymentCancelled` | `UnknownSitter`, `UnknownPayment`, `PaymentAlreadyCancelled`, `SitterNotActive` |

Each event carries the outcome the decision worked out, such as `amount` and `balanceAfter`, so views copy numbers instead of recomputing them. A sitter's events don't name the sitter: views read it from the stream they come from.

## Rules

- **A shift is priced at the sitter's rate in force on its day**, and keeps that price. A rate set later doesn't change it; `CorrectShift` re-prices it at the rate of its date, which is how a retroactive rate change is applied.
- **A household rate applies to every active sitter**, and to every sitter registered later, unless the sitter's own rate starts on or after the same date.
- **Rates only move forward**, on the rate card and in each sitter's schedule. A new rate must start after the latest one.
- **Nothing is recorded in the future.** A shift or payment dated after today (Europe/Paris) is refused with `DateInFuture`. This catches an LLM reading "Friday" as next Friday.
- **Payments never exceed what is owed**, and an archived sitter has a zero balance.
- **Ids are unique, names aren't.** Registering an id twice is refused. Two sitters may share a name or nickname, ignoring case and accents; `SitterDirectory` lists those in `sharedNames`.
- **Repeating a cancel or a correction is refused** with a rejection that says why (`ShiftAlreadyCancelled`, `NothingToCorrect`), so a client always learns what happened.

## Views

| View | Key | Answers |
|---|---|---|
| `SitterDirectory` | `home` | Every sitter by id: name, nicknames, IBAN, active, and the `sharedNames` that more than one active sitter goes by. Turns "Maria" into `maria`. |
| `HourlyRates` | `home` | The household's rates, oldest first. |
| `SitterBalance` | sitter id | One sitter's balance, active flag, rates and last payment. |
| `SitterStatement` | sitter id | One `StatementLine` per shift, payment, correction or cancellation, with the balance after each. Read with `list`. |
| `Payouts` | `home` | What to wire to whom: amount, IBAN and reference (`Babysitting 2026-11-09 to 2026-11-13`) per sitter owed money, and the total. |

`SitterDirectory` and `Payouts` are keyed by the value `home` and read every sitter's events (`keyOf` routes them all to `home`).

## From a sentence to a shift

"Maria 4h on Friday", told to an LLM connected over MCP on Sunday 15 November 2026 (the [walkthrough](/building/walkthrough/) shows the real tool calls and results):

1. The LLM reads `SitterDirectory` and finds that "Maria" is `maria`, and that it isn't in `sharedNames`.
2. It works out that the most recent Friday is `2026-11-13` and that 4 hours is `240` minutes.
3. It sends `LogShift { date: "2026-11-13", minutes: 240 }` to `maria`.
4. Maria's book finds her rate in force on 13 November (€15/h), prices the shift at 6000 cents, and records `ShiftLogged` with `balanceAfter: 6000`.
5. The views update: Maria's balance, her statement, and the payouts.
6. The reply comes back: `{ shiftId: "2026-11-13", amount: 6000, balance: 6000, otherShiftsThatDay: 0 }`. The LLM can say "Logged 4h for Maria on Friday 13 November: €60. You now owe her €60."

## Tests

Every rule above is a story in `packages/domain/test/`: given some history, when a command arrives, then these events, this reply or this rejection, and these view states. Stories run the whole model in memory, policies included, so the rate stories check what reaches each sitter. One more test checks the model's declaration with `Domain.verify`.
