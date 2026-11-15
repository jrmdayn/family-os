import * as Domain from "@alchemy.run/domain";
import * as Layer from "effect/Layer";
import {
  HourlyRateOnboarding,
  HourlyRateOnboardingLive,
} from "./Babysitting/HourlyRateOnboarding.policy.ts";
import {
  HourlyRateRollout,
  HourlyRateRolloutLive,
} from "./Babysitting/HourlyRateRollout.policy.ts";
import { HourlyRates, HourlyRatesLive } from "./Babysitting/HourlyRates.view.ts";
import { Payouts, PayoutsLive } from "./Babysitting/Payouts.view.ts";
import { RateCard } from "./Babysitting/RateCard.aggregate.ts";
import { Sitter } from "./Babysitting/Sitter.aggregate.ts";
import { SitterBalance, SitterBalanceLive } from "./Babysitting/SitterBalance.view.ts";
import { SitterDirectory, SitterDirectoryLive } from "./Babysitting/SitterDirectory.view.ts";
import { SitterStatement, SitterStatementLive } from "./Babysitting/SitterStatement.view.ts";

/** Family OS: everything hosted together. Today, the babysitting ledger. */
export class FamilyOs extends Domain.Model("FamilyOs", {
  aggregates: [Sitter, RateCard],
  views: [SitterDirectory, HourlyRates, SitterBalance, SitterStatement, Payouts],
  policies: [HourlyRateRollout, HourlyRateOnboarding],
}) {}

/** Who may read each view (the `validate` of every guarded view), and the policies' handlers. */
export const FamilyOsHandlers = Layer.mergeAll(
  SitterDirectoryLive,
  HourlyRatesLive,
  SitterBalanceLive,
  SitterStatementLive,
  PayoutsLive,
  HourlyRateRolloutLive,
  HourlyRateOnboardingLive,
);
