import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import { owner } from "@family-os/domain/Actor";
import { HOME } from "@family-os/domain/Babysitting/Household";
import { SitterId } from "@family-os/domain/Babysitting/Sitter.id";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { OwnerApi } from "@family-os/domain/OwnerApi.api";
import { sessionClient } from "@family-os/domain/Session.middleware";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import { OwnerToken, SessionLive } from "../src/Session.ts";

const TOKEN = "a-test-token";

const World = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provide(
    Layer.succeed(OwnerToken, { token: Redacted.make(TOKEN), actor: owner("me@x.fr") }),
  ),
);

const signedInWith = (token: string) =>
  OwnerApi.clientInProcess.pipe(Effect.provide(sessionClient(token)));

const maria = SitterId.make("maria");

it.live("the owner sets the rate, logs a shift, sees what to wire, and records the payment", () =>
  Effect.gen(function* () {
    const api = yield* signedInWith(TOKEN);
    yield* api.SetHourlyRate(HOME, { centsPerHour: 1500, effectiveFrom: "2026-01-01" });
    const registered = yield* api.RegisterSitter(maria, {
      name: "Maria",
      iban: "FR76 3000 6000 0112 3456 7890 189",
    });
    expect(registered.reply).toEqual({
      name: "Maria",
      aliases: [],
      iban: "FR7630006000011234567890189",
    });

    // The household rate reaches a new sitter a moment after they register.
    const rated = yield* api.SitterBalance.get(maria, { atLeast: registered }).pipe(
      Effect.repeat({
        until: (balance) => (balance?.rates.length ?? 0) > 0,
        schedule: Schedule.spaced("10 millis"),
        times: 100,
      }),
    );
    expect(rated?.rates).toEqual([{ centsPerHour: 1500, effectiveFrom: "2026-01-01" }]);

    const logged = yield* api.LogShift(maria, { date: "2026-11-13", minutes: 240 });
    expect(logged.reply).toMatchObject({ amount: 6000, balance: 6000, otherShiftsThatDay: 0 });

    const payouts = yield* api.Payouts.get(HOME, { atLeast: logged });
    expect(payouts?.payouts).toEqual([
      {
        sitterId: maria,
        name: "Maria",
        iban: "FR7630006000011234567890189",
        amount: 6000,
        reference: "Babysitting 2026-11-13",
      },
    ]);

    const paid = yield* api.RecordPayment(maria, { date: "2026-11-15" });
    expect(paid.reply).toMatchObject({ amount: 6000, balance: 0 });
    const balance = yield* api.SitterBalance.get(maria, { atLeast: paid });
    expect(balance).toMatchObject({ balance: 0 });
  }).pipe(Effect.scoped, Effect.provide(World)),
);

it.live(
  "every sitter view can be read atLeast any sitter command's receipt",
  () =>
    Effect.gen(function* () {
      const api = yield* signedInWith(TOKEN);
      // A view only receives the events it consumes, so a receipt for one it skipped
      // would never be reached, and the read would end in ConsistencyTimeout.
      const readAll = (receipt: { readonly stream: string; readonly version: number }) =>
        Effect.all([
          api.SitterDirectory.get(HOME, { atLeast: receipt }),
          api.Payouts.get(HOME, { atLeast: receipt }),
          api.SitterBalance.get(maria, { atLeast: receipt }),
          api.SitterStatement.list(maria, { atLeast: receipt }),
        ]);

      yield* readAll(yield* api.RegisterSitter(maria, { name: "Maria" }));
      yield* readAll(
        yield* api.SetSitterRate(maria, { centsPerHour: 1500, effectiveFrom: "2026-01-01" }),
      );
      yield* readAll(yield* api.UpdateSitter(maria, { aliases: ["Mari"] }));
      const logged = yield* api.LogShift(maria, { date: "2026-11-13", minutes: 240 });
      yield* readAll(logged);
      const { shiftId } = logged.reply;
      yield* readAll(yield* api.CorrectShift(maria, { shiftId, minutes: 180 }));
      const paid = yield* api.RecordPayment(maria, { date: "2026-11-15" });
      yield* readAll(paid);
      yield* readAll(yield* api.CancelPayment(maria, { paymentId: paid.reply.paymentId }));
      yield* readAll(yield* api.CancelShift(maria, { shiftId }));
      const [directory, payouts, balance, statement] = yield* readAll(
        yield* api.ArchiveSitter(maria, {}),
      );

      expect(directory?.sitters[maria]).toMatchObject({ aliases: ["Mari"], active: false });
      expect(payouts).toMatchObject({ payouts: [], total: 0 });
      expect(balance).toMatchObject({ active: false, balance: 0 });
      // Events that add no line still add none.
      expect(statement.entries.map((entry) => entry.event.kind)).toEqual([
        "shift",
        "shift-corrected",
        "payment",
        "payment-cancelled",
        "shift-cancelled",
      ]);
    }).pipe(Effect.scoped, Effect.provide(World)),
  // Long enough to see a ConsistencyTimeout (10 seconds) rather than the test's own timeout.
  30_000,
);

it.live("a rejection reaches the client as its typed error", () =>
  Effect.gen(function* () {
    const api = yield* signedInWith(TOKEN);
    const refused = yield* api
      .LogShift(maria, { date: "2026-11-13", minutes: 60 })
      .pipe(Effect.flip);
    expect(refused).toMatchObject({ _tag: "UnknownSitter", sitterId: "maria" });
  }).pipe(Effect.scoped, Effect.provide(World)),
);

it.live("a wrong token or no token is refused, for commands and reads", () =>
  Effect.gen(function* () {
    const intruder = yield* signedInWith("not-the-token");
    const command = yield* intruder
      .SetHourlyRate(HOME, { centsPerHour: 1, effectiveFrom: "2026-01-01" })
      .pipe(Effect.flip);
    expect(command._tag).toBe("Unauthorized");
    const read = yield* intruder.Payouts.get(HOME).pipe(Effect.flip);
    expect(read._tag).toBe("Unauthorized");
  }).pipe(Effect.scoped, Effect.provide(World)),
);
