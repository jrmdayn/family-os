---
title: The Notion import
description: How the babysitting history moves from the Notion database into Family OS, and how to check it before it does.
---

Before Family OS, the babysitting ledger was a Notion database with one row per shift. `pnpm import-notion` replays its CSV export through the `OwnerApi`, the same calls Claude makes over MCP, so the history lands as ordinary shifts and payments.

The code is in `packages/server/src/NotionImport.ts` (reading, planning, replaying) and `packages/server/src/import-notion.ts` (the command), with tests in `packages/server/test/NotionImport.test.ts`.

## What the export looks like

Notion exports a database as a CSV file. Ours has one file per school year, each with these columns:

| Column | Example | Becomes |
|---|---|---|
| `Title` | `School pickup` | the shift's note (typos such as `Ba ysitting` fixed) |
| `Amount` | `€26.00` | checked against Family OS's price |
| `Date` | `September 18, 2024` | the shift's date, `2024-09-18` |
| `Hours` | `2` | the shift's minutes, rounded to the minute: `120` |
| `Paid at` | `September 22, 2024` | a payment on that day (empty: not paid yet) |
| `Person` | `Zoé` | the sitter, with the id `zoe` |

There is no rate column and no IBAN. Sitters are registered without one; add it later with `UpdateSitter`.

## From rows to a plan

`planImport` turns the rows of every file into a plan, before anything is sent:

- **Rates.** Each row's `Amount / Hours` is its rate. Sorted by date, the rows give the household's rate schedule: a new rate from the first day a different one appears. If a rate comes back after another, or one day has two rates, the plan fails and lists the rows: a mistyped row is likelier than two rate changes.
- **Sitters.** One per `Person`, with a slug of the name as id, registered in order of their first shift.
- **Shifts.** One per row, in minutes. Notion allowed fractions of an hour that aren't whole minutes (`2.33` hours, priced `€27.96`); Family OS takes `140` minutes and prices it at the rate of the day (`€28.00`). The dry run lists every such shift.
- **Payments.** The rows of one sitter with the same `Paid at` make one payment on that day, for what Family OS priced those shifts at, so a rounding difference never leaves a few cents owed. On a given day, shifts are replayed before payments.

## Replaying the plan

`replay` sends the plan through any `OwnerApi` client:

1. `SetHourlyRate` for each rate, oldest first.
2. For each sitter, a few at a time: `RegisterSitter`, then a wait until `HourlyRateOnboarding` has copied every rate to them (`SitterBalance`), then their `LogShift` and `RecordPayment` commands in date order.
3. `SitterBalance` for each sitter, compared with Notion: what they earned, what they were paid, and what they are owed.

Every command carries a `commandId` made from what it records (`notion-import:zoe:shift:2024-09-18:120:School pickup:1`, `notion-import:zoe:paid:2024-09-22`). Domain answers a resent `commandId` with its first receipt, so running the import again after a failure resumes it, and running it twice changes nothing. Ids come from a shift's content, not its line number, so a new export in another order keeps them.

## Running it

The export holds people's names and pay: keep it out of the repository.

A dry run replays everything into a model in memory, as `pnpm dev` does, and prints the report. Nothing leaves the machine:

```sh
pnpm import-notion 2023-2024.csv 2024-2025.csv
```

```
Household rates:
  €12.00/h from 2023-09-25
  €13.00/h from 2024-09-08

Sitter       Shifts  Hours  Earned (Notion)  Earned  Paid (Notion)  Paid  Balance (Notion)  Balance
Zoé (zoe)         3   7.33           €90.96  €91.00         €90.96  €91.00           €0.00    €0.00  ok
Ines (ines)       2   6.75           €85.00  €85.00         €33.00  €33.00          €52.00   €52.00  ok

Shifts priced differently from Notion (…):
  2023-2024.csv:2: Zoé 2023-09-25, 2.33h → 140 min: Notion €27.96, Family OS €28.00

Every balance matches Notion.
```

It exits with an error when a balance doesn't match. Once they all do, import into a stage with `--into` and the owner token:

```sh
FAMILY_OS_TOKEN=… pnpm import-notion 2023-2024.csv 2024-2025.csv --into https://family-os-dev.jrmdayn.workers.dev
```

Try `dev` first, then `prod`. The import expects an empty ledger: a sitter registered by hand with the same id is refused as `SitterAlreadyRegistered`, and a household rate set by hand on a later date as `RateNotAfterLatest`.
