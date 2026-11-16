/**
 * The Notion import: turn the CSV export of the old Notion babysitting
 * database into a plan (the household rates, the sitters, and each sitter's
 * shifts and payments in date order), then replay that plan through the
 * OwnerApi, in memory for a dry run or against a deployed stage.
 *
 * The Notion database has one row per shift: Title, Amount, Date, Hours,
 * Paid at, Person. It has no rate column: the rates are worked out from
 * Amount / Hours, and every row must agree with the schedule that gives.
 * Payments are the rows of one person with the same "Paid at" date.
 *
 * Every command carries a commandId derived from the row it comes from, so
 * running the import again after a failure resumes it: Domain returns the
 * first receipt for a command it already decided.
 */
import { HOME } from "@family-os/domain/Babysitting/Household";
import type { Rate } from "@family-os/domain/Babysitting/Rate";
import { SitterId } from "@family-os/domain/Babysitting/Sitter.id";
import type { OwnerApi } from "@family-os/domain/OwnerApi.api";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";

// READING THE EXPORT

/** One row of the Notion database: a shift, and when it was paid. */
export interface NotionRow {
  /** Where the row comes from, `file:line`, for messages. */
  readonly source: string;
  readonly title: string;
  readonly amount: number;
  readonly date: string;
  readonly hours: number;
  readonly paidAt: string | null;
  readonly person: string;
}

/** Splits CSV text into records: commas, double quotes, `""` inside quotes, CRLF or LF. */
export const parseCsv = (text: string): Array<Array<string>> => {
  const records: Array<Array<string>> = [];
  let record: Array<string> = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      record.push(field);
      if (record.some((value) => value.trim() !== "")) records.push(record);
      record = [];
      field = "";
    } else field += char;
  }
  record.push(field);
  if (record.some((value) => value.trim() !== "")) records.push(record);
  return records;
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Notion's "September 8, 2024" as `2024-09-08`. */
export const parseNotionDate = (value: string, source: string): string => {
  const match = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(value.trim());
  const month = match ? MONTHS.indexOf(match[1]!.toLowerCase()) + 1 : 0;
  if (!match || month === 0) throw new Error(`${source}: "${value}" is not a date`);
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
};

/** "€1,039.50" as 103950 cents. */
export const parseEuros = (value: string, source: string): number => {
  const cleaned = value.replace(/[€\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error(`${source}: "${value}" is not an amount`);
  return Math.round(Number(cleaned) * 100);
};

const COLUMNS = ["Title", "Amount", "Date", "Hours", "Paid at", "Person"] as const;

/** The rows of one exported CSV file. `file` names it in messages. */
export const readNotionCsv = (file: string, text: string): Array<NotionRow> => {
  const [header, ...records] = parseCsv(text);
  if (!header) return [];
  const index = Object.fromEntries(
    COLUMNS.map((column) => {
      const at = header.findIndex((name) => name.trim() === column);
      if (at < 0) throw new Error(`${file}: no "${column}" column (found: ${header.join(", ")})`);
      return [column, at];
    }),
  ) as Record<(typeof COLUMNS)[number], number>;
  return records.map((record, i) => {
    const source = `${file}:${i + 2}`;
    const cell = (column: (typeof COLUMNS)[number]) => (record[index[column]] ?? "").trim();
    const hours = Number(cell("Hours"));
    if (!(hours > 0)) throw new Error(`${source}: "${cell("Hours")}" is not a number of hours`);
    const person = cell("Person");
    if (person === "") throw new Error(`${source}: no Person`);
    return {
      source,
      title: cell("Title"),
      amount: parseEuros(cell("Amount"), source),
      date: parseNotionDate(cell("Date"), source),
      hours,
      paidAt: cell("Paid at") === "" ? null : parseNotionDate(cell("Paid at"), source),
      person,
    };
  });
};

// THE PLAN

export interface PlannedShift {
  readonly _tag: "Shift";
  readonly commandId: string;
  readonly date: string;
  readonly minutes: number;
  readonly note: string;
  readonly row: NotionRow;
}

export interface PlannedPayment {
  readonly _tag: "Payment";
  readonly commandId: string;
  readonly date: string;
  /** The shifts this payment settles: its amount is what they come to. */
  readonly shifts: ReadonlyArray<PlannedShift>;
}

export interface PlannedSitter {
  readonly sitterId: SitterId;
  readonly name: string;
  /** Shifts and payments, oldest first; on the same day, shifts before payments. */
  readonly steps: ReadonlyArray<PlannedShift | PlannedPayment>;
  /** What Notion says this sitter is owed: the rows without a "Paid at". */
  readonly notionBalance: number;
}

export interface Plan {
  /** The household's rates, oldest first, worked out from the rows. */
  readonly rates: ReadonlyArray<Rate>;
  /** In order of their first shift. */
  readonly sitters: ReadonlyArray<PlannedSitter>;
}

/** "Ana Lucía" → "ana-lucia". */
export const slugOf = (name: string): SitterId =>
  SitterId.make(
    name
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  );

/** Notion's titles, with their typos fixed: "Ba ysitting" and "Baby sitting" are "Babysitting". */
export const noteOf = (title: string): string => {
  const tidy = title.replace(/\s+/g, " ").trim();
  return /^bab?ysitting$/i.test(tidy.replace(/\s/g, "")) ? "Babysitting" : tidy;
};

const byDate = <A extends { readonly date: string }>(a: A, b: A) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/**
 * The household's rate schedule implied by the rows: each row's Amount /
 * Hours, rounded to the cent, starting a new rate on the first day it
 * changes. Fails, listing the rows, if a row disagrees with that schedule:
 * rows of one day at different rates, or a rate that comes back after
 * another (more likely a mistyped row than two rate changes).
 */
export const ratesOf = (rows: ReadonlyArray<NotionRow>): Array<Rate> => {
  const rateOfRow = (row: NotionRow) => Math.round(row.amount / row.hours);
  const periods: Array<{ rate: Rate; rows: Array<NotionRow> }> = [];
  for (const row of [...rows].sort(byDate)) {
    const latest = periods.at(-1);
    if (latest?.rate.centsPerHour === rateOfRow(row)) latest.rows.push(row);
    else
      periods.push({
        rate: { centsPerHour: rateOfRow(row), effectiveFrom: row.date },
        rows: [row],
      });
  }
  const odd = new Set<NotionRow>();
  periods.forEach((period, i) => {
    if (i > 0 && periods[i - 1]!.rate.effectiveFrom === period.rate.effectiveFrom) {
      for (const row of [...periods[i - 1]!.rows, ...period.rows]) {
        if (row.date === period.rate.effectiveFrom) odd.add(row);
      }
    }
    const back = periods.findLastIndex((p) => p.rate.centsPerHour === period.rate.centsPerHour);
    for (const between of periods.slice(i + 1, back)) for (const row of between.rows) odd.add(row);
  });
  if (odd.size > 0) {
    throw new Error(
      [
        "These rows don't fit one rate schedule (Amount / Hours):",
        ...rows
          .filter((row) => odd.has(row))
          .map(
            (row) =>
              `  ${row.source}: ${row.person} ${row.date}, ${row.hours}h for ${row.amount}c = ${rateOfRow(row)}c/h`,
          ),
      ].join("\n"),
    );
  }
  return periods.map((period) => period.rate);
};

/** The import plan for the rows of every exported file. */
export const planImport = (rows: ReadonlyArray<NotionRow>): Plan => {
  const rates = ratesOf(rows);
  const people = new Map<SitterId, { name: string; rows: Array<NotionRow> }>();
  for (const row of [...rows].sort(byDate)) {
    const sitterId = slugOf(row.person);
    const person = people.get(sitterId);
    if (person && person.name !== row.person) {
      throw new Error(`${row.source}: "${row.person}" and "${person.name}" have the same id`);
    }
    if (person) person.rows.push(row);
    else people.set(sitterId, { name: row.person, rows: [row] });
  }

  const sitters = [...people].map(([sitterId, { name, rows: theirs }]): PlannedSitter => {
    const seen = new Map<string, number>();
    const shifts = theirs.map((row): PlannedShift => {
      const minutes = Math.round(row.hours * 60);
      const note = noteOf(row.title);
      // Identify the shift by what it is, not by its position in the export.
      const key = `${row.date}:${minutes}:${note}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      return {
        _tag: "Shift",
        commandId: `notion-import:${sitterId}:shift:${key}:${n}`,
        date: row.date,
        minutes,
        note,
        row,
      };
    });
    const byPaidAt = new Map<string, Array<PlannedShift>>();
    for (const shift of shifts) {
      const paidAt = shift.row.paidAt;
      if (paidAt === null) continue;
      if (paidAt < shift.date) {
        throw new Error(
          `${shift.row.source}: paid on ${paidAt}, before the shift on ${shift.date}`,
        );
      }
      byPaidAt.set(paidAt, [...(byPaidAt.get(paidAt) ?? []), shift]);
    }
    const payments = [...byPaidAt].map(([date, settled]): PlannedPayment => ({
      _tag: "Payment",
      commandId: `notion-import:${sitterId}:paid:${date}`,
      date,
      shifts: settled,
    }));
    const steps = [...shifts, ...payments].sort(
      (a, b) => byDate(a, b) || (a._tag === b._tag ? 0 : a._tag === "Shift" ? -1 : 1),
    );
    const notionBalance = theirs
      .filter((row) => row.paidAt === null)
      .reduce((sum, row) => sum + row.amount, 0);
    return { sitterId, name, steps, notionBalance };
  });
  return { rates, sitters };
};

// REPLAYING IT

export type OwnerClient = Effect.Success<typeof OwnerApi.client>;

/** A shift whose price in Family OS differs from Notion's Amount. */
export interface PriceDifference {
  readonly source: string;
  readonly date: string;
  readonly hours: number;
  readonly minutes: number;
  readonly notion: number;
  readonly familyOs: number;
}

/** One sitter after the import, next to what Notion says. */
export interface SitterResult {
  readonly sitterId: SitterId;
  readonly name: string;
  readonly shifts: number;
  readonly minutes: number;
  readonly earned: { readonly notion: number; readonly familyOs: number };
  readonly paid: { readonly notion: number; readonly familyOs: number };
  readonly balance: { readonly notion: number; readonly familyOs: number };
  readonly priceDifferences: ReadonlyArray<PriceDifference>;
}

export interface ImportResult {
  readonly rates: ReadonlyArray<Rate>;
  readonly sitters: ReadonlyArray<SitterResult>;
}

/** Replays one sitter's book: registers them, waits for the household rates, then shifts and payments. */
const replaySitter = (api: OwnerClient, plan: Plan, sitter: PlannedSitter) =>
  Effect.gen(function* () {
    const { sitterId } = sitter;
    const registered = yield* api.RegisterSitter(
      sitterId,
      { name: sitter.name },
      { commandId: `notion-import:${sitterId}:register` },
    );
    // HourlyRateOnboarding copies the household rates to a new sitter a moment after they register.
    yield* api.SitterBalance.get(sitterId, { atLeast: registered }).pipe(
      Effect.repeat({
        until: (balance) => (balance?.rates.length ?? 0) >= plan.rates.length,
        schedule: Schedule.spaced("100 millis"),
        times: 100,
      }),
    );

    const prices = new Map<PlannedShift, number>();
    let last: { readonly stream: string; readonly version: number } = registered;
    let paid = 0;
    for (const step of sitter.steps) {
      if (step._tag === "Shift") {
        const logged = yield* api.LogShift(
          sitterId,
          { date: step.date, minutes: step.minutes, note: step.note },
          { commandId: step.commandId },
        );
        prices.set(step, logged.reply.amount);
        last = logged;
      } else {
        const amount = step.shifts.reduce((sum, shift) => sum + (prices.get(shift) ?? 0), 0);
        if (amount <= 0) continue;
        const payment = yield* api.RecordPayment(
          sitterId,
          { amount, date: step.date },
          { commandId: step.commandId },
        );
        paid += payment.reply.amount;
        last = payment;
      }
    }

    const balance = yield* api.SitterBalance.get(sitterId, { atLeast: last });
    const shifts = [...prices];
    const rows = shifts.map(([shift]) => shift.row);
    return {
      sitterId,
      name: sitter.name,
      shifts: shifts.length,
      minutes: shifts.reduce((sum, [shift]) => sum + shift.minutes, 0),
      earned: {
        notion: rows.reduce((sum, row) => sum + row.amount, 0),
        familyOs: shifts.reduce((sum, [, amount]) => sum + amount, 0),
      },
      paid: {
        notion: rows.filter((row) => row.paidAt !== null).reduce((sum, row) => sum + row.amount, 0),
        familyOs: paid,
      },
      balance: { notion: sitter.notionBalance, familyOs: balance?.balance ?? Number.NaN },
      priceDifferences: shifts
        .filter(([shift, amount]) => amount !== shift.row.amount)
        .map(([shift, amount]) => ({
          source: shift.row.source,
          date: shift.date,
          hours: shift.row.hours,
          minutes: shift.minutes,
          notion: shift.row.amount,
          familyOs: amount,
        })),
    } satisfies SitterResult;
  });

/**
 * Replays the plan through the Api: the household rates first, then each
 * sitter's book (a few sitters at a time; each sitter's steps in order).
 * `onSitter` reports progress.
 */
export const replay = (
  api: OwnerClient,
  plan: Plan,
  onSitter: (result: SitterResult) => Effect.Effect<void> = () => Effect.void,
) =>
  Effect.gen(function* () {
    for (const rate of plan.rates) {
      yield* api.SetHourlyRate(HOME, rate, {
        commandId: `notion-import:rate:${rate.effectiveFrom}`,
      });
    }
    const sitters = yield* Effect.forEach(
      plan.sitters,
      (sitter) => replaySitter(api, plan, sitter).pipe(Effect.tap(onSitter)),
      { concurrency: 4 },
    );
    return { rates: plan.rates, sitters } satisfies ImportResult;
  });

// THE REPORT

const euros = (cents: number) =>
  Number.isNaN(cents) ? "?" : `€${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((row) => row[i]!.length)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === 0 ? cell.padEnd(widths[i]!) : cell.padStart(widths[i]!)))
        .join("  "),
    )
    .join("\n");
};

/** Whether every sitter's balance in Family OS matches Notion's. */
export const balancesMatch = (result: ImportResult) =>
  result.sitters.every((sitter) => sitter.balance.familyOs === sitter.balance.notion);

/** The result as text: the rates, a line per sitter, and every shift priced differently from Notion. */
export const formatResult = (result: ImportResult): string => {
  const lines = [
    "Household rates:",
    ...result.rates.map((rate) => `  ${euros(rate.centsPerHour)}/h from ${rate.effectiveFrom}`),
    "",
    table([
      [
        "Sitter",
        "Shifts",
        "Hours",
        "Earned (Notion)",
        "Earned",
        "Paid (Notion)",
        "Paid",
        "Balance (Notion)",
        "Balance",
        "",
      ],
      ...result.sitters.map((s) => [
        `${s.name} (${s.sitterId})`,
        String(s.shifts),
        (s.minutes / 60).toFixed(2),
        euros(s.earned.notion),
        euros(s.earned.familyOs),
        euros(s.paid.notion),
        euros(s.paid.familyOs),
        euros(s.balance.notion),
        euros(s.balance.familyOs),
        s.balance.familyOs === s.balance.notion ? "ok" : "MISMATCH",
      ]),
    ]),
  ];
  const differences = result.sitters.flatMap((s) =>
    s.priceDifferences.map((d) => ({ ...d, name: s.name })),
  );
  if (differences.length > 0) {
    lines.push(
      "",
      "Shifts priced differently from Notion (Family OS keeps whole minutes; their payment is what Family OS priced):",
      ...differences.map(
        (d) =>
          `  ${d.source}: ${d.name} ${d.date}, ${d.hours}h → ${d.minutes} min: Notion ${euros(d.notion)}, Family OS ${euros(d.familyOs)}`,
      ),
    );
  }
  lines.push(
    "",
    balancesMatch(result)
      ? "Every balance matches Notion."
      : "Some balances don't match Notion: see MISMATCH above.",
  );
  return lines.join("\n");
};
