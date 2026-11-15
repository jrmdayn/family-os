import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import { system } from "../Actor.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { HOME } from "./Household.ts";
import { RateCard } from "./RateCard.aggregate.ts";
import { SitterRegistered } from "./RegisterSitter.command.ts";
import { SetSitterRate } from "./SetSitterRate.command.ts";
import { Sitter } from "./Sitter.aggregate.ts";

/**
 * Whenever a sitter registers, they get the household's whole rate schedule,
 * so shifts from before they joined (an import, a late entry) can be priced
 * too. It reads the rate card itself, not a view, so it never misses a rate
 * set just before. Running it again changes nothing: each rate is refused as
 * `RateNotAfterLatest` the second time.
 */
export class HourlyRateOnboarding extends Domain.Policy("HourlyRateOnboarding", {
  from: Sitter,
  on: [SitterRegistered],
}) {}

export const HourlyRateOnboardingLive = HourlyRateOnboarding.toLayer(
  Effect.gen(function* () {
    const rateCard = yield* RateCard;
    const sitters = yield* Sitter;
    return Effect.fn(
      function* ({ source }) {
        const { rates } = yield* rateCard.get(HOME);
        yield* Effect.forEach(
          rates,
          (rate) =>
            sitters
              .send(source, new SetSitterRate(rate))
              .pipe(
                Effect.catchTag(
                  ["RateNotAfterLatest", "SitterNotActive", "UnknownSitter"],
                  () => Effect.void,
                ),
              ),
          { discard: true },
        );
      },
      Effect.provideService(CurrentActor, system("HourlyRateOnboarding")),
    );
  }),
);
