---
title: The babysitting model
description: The words, rules, commands and views of the babysitting ledger, and how "Maria 4h on Friday" becomes a recorded shift.
---

The babysitting ledger lives in `packages/domain/src/Babysitting/`. It is an Alchemy Domain model: commands ask for a change, one aggregate decides, events record what happened, and views answer questions.

## Glossary

| Word | Meaning |
|---|---|
| **Ledger** | The household's babysitting book. There is exactly one, with the id `home`. |
| **Sitter** | Someone who babysits. Identified by a slug of their name (`maria`, `ana-lucia`), with nicknames and an IBAN. |
| **Rate** | The hourly rate every sitter is paid, in cents, from an `effectiveFrom` date until the next rate. |
| **Shift** | A sitter babysat on a day for some minutes. Priced when logged: `amount = round(minutes × rate / 60)`. Id: `maria-2026-11-13` (`-2`, `-3` for more shifts that day). |
| **Payment** | Money wired to a sitter. Id: `maria-paid-2026-11-15`. |
| **Balance** | What you owe a sitter: their shifts minus their payments. Negative means they owe you. |
| **Payout** | A line of "what to wire to whom": a sitter with a positive balance, their IBAN and a transfer reference. |
| **Archived** | A sitter who no longer babysits. Their ledger is closed with a zero balance; their history stays readable. |

Units are fixed everywhere: money in **euro cents**, durations in **minutes**, dates as **`YYYY-MM-DD` in Europe/Paris**.

## One aggregate: the ledger

Every command goes to the `Ledger` aggregate (`Ledger.aggregate.ts`). Its state holds the rate schedule, the sitters with their balances, and every shift and payment.

The reason it is one aggregate and not one per sitter: pricing a shift needs the rate of its day, and a decision can only read its own aggregate's state. Keeping the rate and the sitters together lets `LogShift` price the shift and update the balance in one step. It also lets `RegisterSitter` check that no two sitters share a name or nickname. A household's volume (a few shifts a week) is far below what one aggregate handles. See [Decisions](/decisions/).

## Commands

Every command targets `home` and requires a session.

| Command | Input | Records | Refused with |
|---|---|---|---|
| `SetHourlyRate` | `centsPerHour`, `effectiveFrom` | `HourlyRateSet` (nothing if the rate is unchanged) | `RateNotAfterLatest` |
| `RegisterSitter` | `name`, `aliases?`, `iban?` | `SitterRegistered`; replies with the `sitterId` | `NameTaken`, `UnusableName` |
| `UpdateSitter` | `sitterId`, `name?`, `aliases?`, `iban?` (null removes it) | `SitterDetailsChanged` (nothing if unchanged) | `UnknownSitter`, `NameTaken` |
| `ArchiveSitter` | `sitterId` | `SitterArchived` (nothing if already archived) | `UnknownSitter`, `OutstandingBalance` |
| `LogShift` | `sitterId`, `date`, `minutes`, `note?` | `ShiftLogged` with rate, amount and balance after | `UnknownSitter`, `SitterNotActive`, `NoRateForDate`, `DateInFuture` |
| `CorrectShift` | `shiftId`, `date?`, `minutes?`, `note?` | `ShiftCorrected`, re-priced at the rate of its date | `UnknownShift`, `ShiftAlreadyCancelled`, `NothingToCorrect`, `SitterNotActive`, `NoRateForDate`, `DateInFuture` |
| `CancelShift` | `shiftId` | `ShiftCancelled` | `UnknownShift`, `ShiftAlreadyCancelled`, `SitterNotActive` |
| `RecordPayment` | `sitterId`, `amount?` (whole balance), `date?` (today) | `PaymentRecorded` | `UnknownSitter`, `NothingOwed`, `MoreThanOwed`, `DateInFuture` |
| `CancelPayment` | `paymentId` | `PaymentCancelled` | `UnknownPayment`, `PaymentAlreadyCancelled`, `SitterNotActive` |

Each event carries the outcome the decision worked out, such as `amount` and `balanceAfter`, so views copy numbers instead of recomputing them.

## Rules

- **A shift is priced at the rate in force on its day**, and keeps that price. A rate set later doesn't change it; `CorrectShift` re-prices it at the rate of its date, which is how a retroactive rate change is applied.
- **Rates only move forward.** A new rate must start after the latest one.
- **Nothing is recorded in the future.** A shift or payment dated after today (Europe/Paris) is refused with `DateInFuture`. This catches an LLM reading "Friday" as next Friday.
- **Payments never exceed what is owed**, and an archived sitter has a zero balance.
- **Names are unique** across sitters, ignoring case and accents, nicknames included.
- **Repeating a cancel or a correction is refused** with a rejection that says why (`ShiftAlreadyCancelled`, `NothingToCorrect`), so a client always learns what happened.

## Views

| View | Key | Answers |
|---|---|---|
| `SitterDirectory` | `home` | Every sitter by id: name, nicknames, IBAN, active. Turns "Maria" into `maria`. |
| `HourlyRates` | `home` | Every rate, oldest first. |
| `SitterBalance` | sitter id | One sitter's balance, active flag and last payment. |
| `SitterStatement` | sitter id | One `StatementLine` per shift, payment, correction or cancellation, with the balance after each. Read with `list`. |
| `Payouts` | `home` | What to wire to whom: amount, IBAN and reference (`Babysitting 2026-11-09 to 2026-11-13`) per sitter owed money, and the total. |

## From a sentence to a shift

"Maria 4h on Friday", told to an LLM connected over MCP on Sunday 15 November 2026:

1. The LLM reads `SitterDirectory` and finds that "Maria" is `maria`.
2. It works out that the most recent Friday is `2026-11-13` and that 4 hours is `240` minutes.
3. It sends `LogShift { sitterId: "maria", date: "2026-11-13", minutes: 240 }` to `home`.
4. The ledger finds the rate in force on 13 November (€15/h), prices the shift at 6000 cents, and records `ShiftLogged` with `balanceAfter: 6000`.
5. The views update: Maria's balance, her statement, and the payouts.
6. The reply comes back: `{ shiftId: "maria-2026-11-13", amount: 6000, balance: 6000, otherShiftsThatDay: 0 }`. The LLM can say "Logged 4h for Maria on Friday 13 November: €60. You now owe her €60."

## Tests

Every rule above is a story in `packages/domain/test/`: given some history, when a command arrives, then these events, this reply or this rejection, and these view states. Stories run the whole model in memory. One more test checks the model's declaration with `Domain.verify`.
