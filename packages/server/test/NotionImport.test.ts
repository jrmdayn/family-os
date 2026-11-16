import * as Domain from "@alchemy.run/domain";
import { describe, expect, it } from "@effect/vitest";
import { owner } from "@family-os/domain/Actor";
import { HOME } from "@family-os/domain/Babysitting/Household";
import { SitterId } from "@family-os/domain/Babysitting/Sitter.id";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { OwnerApi } from "@family-os/domain/OwnerApi.api";
import { sessionClient } from "@family-os/domain/Session.middleware";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import {
  balancesMatch,
  parseCsv,
  planImport,
  readNotionCsv,
  replay,
  slugOf,
} from "../src/NotionImport.ts";
import { OwnerToken, SessionLive } from "../src/Session.ts";

const TOKEN = "a-test-token";

const World = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provide(
    Layer.succeed(OwnerToken, { token: Redacted.make(TOKEN), actor: owner("me@x.fr") }),
  ),
);

const api = OwnerApi.clientInProcess.pipe(Effect.provide(sessionClient(TOKEN)));

// Made-up history in the shape of the Notion export: €12/h, then €13/h from
// 8 September 2024; a typo in a title; 2.33 hours priced by Notion at €27.96;
// a payment covering two shifts; one shift not paid yet.
const LAST_YEAR = `﻿Title,Amount,Date,Hours,Paid at,Person
School pickup,€27.96,"September 25, 2023",2.33,"September 29, 2023",Zoé
School pickup,€24.00,"September 29, 2023",2,"September 29, 2023",Zoé
Baby sitting,€33.00,"October 5, 2023",2.75,"October 10, 2023",Ines
`;
const THIS_YEAR = `Title,Amount,Date,Hours,Paid at,Person
Ba ysitting,€39.00,"September 8, 2024",3,"September 9, 2024",Zoé
"Babysitting, late",€52.00,"November 13, 2026",4,,Ines
`;

const rows = [...readNotionCsv("2023.csv", LAST_YEAR), ...readNotionCsv("2024.csv", THIS_YEAR)];

describe("reading the export", () => {
  it("parses quoted fields, escaped quotes and empty cells", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,,3\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "", "3"],
    ]);
  });

  it("reads amounts in cents, dates as ISO, and no Paid at as unpaid", () => {
    expect(rows[0]).toEqual({
      source: "2023.csv:2",
      title: "School pickup",
      amount: 2796,
      date: "2023-09-25",
      hours: 2.33,
      paidAt: "2023-09-29",
      person: "Zoé",
    });
    expect(rows[4]).toMatchObject({ title: "Babysitting, late", paidAt: null });
  });

  it("makes ids from names without accents", () => {
    expect(slugOf("Zoé")).toBe("zoe");
    expect(slugOf("Ana Lucía")).toBe("ana-lucia");
  });
});

describe("the plan", () => {
  const plan = planImport(rows);

  it("works out the household rates from Amount / Hours", () => {
    expect(plan.rates).toEqual([
      { centsPerHour: 1200, effectiveFrom: "2023-09-25" },
      { centsPerHour: 1300, effectiveFrom: "2024-09-08" },
    ]);
  });

  it("refuses rows that don't fit one rate schedule", () => {
    const odd = readNotionCsv(
      "odd.csv",
      `Title,Amount,Date,Hours,Paid at,Person
Babysitting,€24.00,"September 1, 2024",2,,Zoé
Babysitting,€30.00,"September 2, 2024",2,,Zoé
Babysitting,€24.00,"September 3, 2024",2,,Zoé
`,
    );
    expect(() => planImport(odd)).toThrow(/odd\.csv:3: Zoé 2024-09-02, 2h for 3000c = 1500c\/h/);
  });

  it("groups a sitter's rows paid on the same day into one payment, after that day's shifts", () => {
    const zoe = plan.sitters.find((s) => s.sitterId === "zoe")!;
    expect(zoe.steps.map((s) => `${s._tag} ${s.date}`)).toEqual([
      "Shift 2023-09-25",
      "Shift 2023-09-29",
      "Payment 2023-09-29",
      "Shift 2024-09-08",
      "Payment 2024-09-09",
    ]);
  });

  it("fixes the typos in titles, which become the shifts' notes", () => {
    const notes = plan.sitters.flatMap((s) =>
      s.steps.flatMap((step) => (step._tag === "Shift" ? [step.note] : [])),
    );
    expect(notes).toEqual([
      "School pickup",
      "School pickup",
      "Babysitting",
      "Babysitting",
      "Babysitting, late",
    ]);
  });
});

it.live("replays the history: balances match Notion, and a second run changes nothing", () =>
  Effect.gen(function* () {
    const client = yield* api;
    const plan = planImport(rows);
    const result = yield* replay(client, plan);

    expect(balancesMatch(result)).toBe(true);
    const zoe = result.sitters.find((s) => s.sitterId === "zoe")!;
    // 2.33 hours is 140 minutes, €28.00 at €12/h: paid as priced, so nothing is left owed.
    expect(zoe.priceDifferences).toEqual([
      {
        source: "2023.csv:2",
        date: "2023-09-25",
        hours: 2.33,
        minutes: 140,
        notion: 2796,
        familyOs: 2800,
      },
    ]);
    expect(zoe).toMatchObject({
      earned: { notion: 9096, familyOs: 9100 },
      paid: { notion: 9096, familyOs: 9100 },
      balance: { notion: 0, familyOs: 0 },
    });
    expect(result.sitters.find((s) => s.sitterId === "ines")).toMatchObject({
      balance: { notion: 5200, familyOs: 5200 },
    });

    const again = yield* replay(client, plan);
    expect(again).toEqual(result);
    const statement = yield* client.SitterStatement.list(SitterId.make("zoe"));
    expect(statement.entries.filter((entry) => entry.event.kind === "shift")).toHaveLength(3);
    const payouts = yield* client.Payouts.get(HOME);
    expect(payouts?.payouts.map((p) => [p.sitterId, p.amount])).toEqual([["ines", 5200]]);
  }).pipe(Effect.scoped, Effect.provide(World)),
);
