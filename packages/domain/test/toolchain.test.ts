/**
 * Toolchain smoke test: proves that @alchemy.run/domain, effect, vitest and
 * @effect/vitest work together in this workspace. It declares a throwaway
 * aggregate inline; delete this file once the real model (M1) has stories.
 */
import * as Domain from "@alchemy.run/domain";
import { Story } from "@alchemy.run/domain/Story";
import { it } from "@effect/vitest";
import * as Schema from "effect/Schema";

const LampId = Schema.String.pipe(Schema.brand("LampId"));

class SwitchedOn extends Domain.Event("SwitchedOn", {}) {}
class AlreadyOn extends Domain.Rejection("AlreadyOn") {}
class SwitchOn extends Domain.Command("SwitchOn", {
  target: LampId,
  input: {},
  events: [SwitchedOn],
  rejects: [AlreadyOn],
}) {}

class Lamp extends Domain.Aggregate("Lamp", {
  id: LampId,
  state: Schema.Struct({ on: Schema.Boolean }),
  initial: { on: false },
  commands: [SwitchOn],
  decide: {
    SwitchOn: (lamp) => (lamp.on ? new AlreadyOn() : [new SwitchedOn()]),
  },
  evolve: {
    SwitchedOn: () => ({ on: true }),
  },
}) {}

class House extends Domain.Model("House", { aggregates: [Lamp] }) {}

const story = Story.make(House);
const lamp = Lamp.ref("kitchen");

it.effect("switches a lamp on", () =>
  story(Story.when(lamp, new SwitchOn()), Story.then(lamp, new SwitchedOn())),
);

it.effect("refuses to switch on a lamp that is already on", () =>
  story(
    Story.given(lamp, new SwitchedOn()),
    Story.when(lamp, new SwitchOn()),
    Story.rejected(new AlreadyOn()),
  ),
);
