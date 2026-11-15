import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";
import { HourlyRates, HourlyRatesLive } from "./Babysitting/HourlyRates.view.ts";
import { Ledger } from "./Babysitting/Ledger.aggregate.ts";
import { Payouts, PayoutsLive } from "./Babysitting/Payouts.view.ts";
import { SitterBalance, SitterBalanceLive } from "./Babysitting/SitterBalance.view.ts";
import { SitterDirectory, SitterDirectoryLive } from "./Babysitting/SitterDirectory.view.ts";
import { SitterStatement, SitterStatementLive } from "./Babysitting/SitterStatement.view.ts";

/** Family OS: everything hosted together. Today, the babysitting ledger. */
export class FamilyOs extends Domain.Model("FamilyOs", {
  aggregates: [Ledger],
  views: [SitterDirectory, HourlyRates, SitterBalance, SitterStatement, Payouts],
}) {}

/** Who may read each view: the `validate` of every guarded view. */
export const FamilyOsHandlers = Layer.mergeAll(
  SitterDirectoryLive,
  HourlyRatesLive,
  SitterBalanceLive,
  SitterStatementLive,
  PayoutsLive,
);
