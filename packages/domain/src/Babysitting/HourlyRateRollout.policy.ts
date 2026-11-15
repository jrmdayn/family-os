import * as Domain from "@alchemy.run/domain";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { system } from "../Actor.ts";
import { CurrentActor } from "../CurrentActor.context.ts";
import { HOME } from "./Household.ts";
import { RateCard } from "./RateCard.aggregate.ts";
import { HourlyRateSet } from "./SetHourlyRate.command.ts";
import { SetSitterRate } from "./SetSitterRate.command.ts";
import { Sitter } from "./Sitter.aggregate.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterDirectory } from "./SitterDirectory.view.ts";

/**
 * Whenever the household's hourly rate changes, every active sitter gets it.
 * A sitter whose own rate already starts on or after that date keeps theirs
 * (`RateNotAfterLatest`), and a sitter archived in the meantime is skipped.
 * Running it again changes nothing, for the same reason.
 */
export class HourlyRateRollout extends Domain.Policy("HourlyRateRollout", {
  from: RateCard,
  on: [HourlyRateSet],
}) {}

export const HourlyRateRolloutLive = HourlyRateRollout.toLayer(
  Effect.gen(function* () {
    const directory = yield* SitterDirectory;
    const sitters = yield* Sitter;
    return Effect.fn(
      function* ({ event }) {
        const known = yield* directory.get(HOME).pipe(Effect.orDie);
        const active = Option.match(known, {
          onNone: () => [],
          onSome: ({ sitters }) =>
            Object.entries(sitters)
              .filter(([, entry]) => entry.active)
              .map(([sitterId]) => SitterId.make(sitterId)),
        });
        yield* Effect.forEach(
          active,
          (sitterId) =>
            sitters
              .send(
                sitterId,
                new SetSitterRate({
                  centsPerHour: event.centsPerHour,
                  effectiveFrom: event.effectiveFrom,
                }),
              )
              .pipe(
                Effect.catchTag(
                  ["RateNotAfterLatest", "SitterNotActive", "UnknownSitter"],
                  () => Effect.void,
                ),
              ),
          { discard: true },
        );
      },
      Effect.provideService(CurrentActor, system("HourlyRateRollout")),
    );
  }),
);
