import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import {
  ArchiveSitter,
  OutstandingBalance,
  SitterArchived,
} from "../src/Babysitting/ArchiveSitter.command.ts";
import { HOME } from "../src/Babysitting/Household.ts";
import {
  RegisterSitter,
  SitterAlreadyRegistered,
  SitterRegistered,
} from "../src/Babysitting/RegisterSitter.command.ts";
import { Sitter } from "../src/Babysitting/Sitter.aggregate.ts";
import { SitterId } from "../src/Babysitting/Sitter.id.ts";
import { SitterBalance } from "../src/Babysitting/SitterBalance.view.ts";
import { SitterDirectory } from "../src/Babysitting/SitterDirectory.view.ts";
import { UnknownSitter } from "../src/Babysitting/UnknownSitter.rejection.ts";
import { SitterDetailsChanged, UpdateSitter } from "../src/Babysitting/UpdateSitter.command.ts";
import {
  anaBook,
  anaJoined,
  asOwner,
  maria,
  MARIA_IBAN,
  mariaBook,
  mariaFriday,
  mariaJoined,
  sitterRate2026,
  story,
  sunday,
} from "./fixtures.ts";

const anaLucia = SitterId.make("ana-lucia");
const maria2 = SitterId.make("maria-2");

describe("RegisterSitter", () => {
  it.effect("registers a sitter under the id it is sent to, with a normalized IBAN", () =>
    story(
      sunday,
      asOwner,
      Story.when(
        Sitter.ref(anaLucia),
        new RegisterSitter({
          name: "Ana Lucía",
          aliases: ["Lu"],
          iban: "fr76 3000 6000 0112 3456 7890 189",
        }),
      ),
      Story.then(
        Sitter.ref(anaLucia),
        new SitterRegistered({ name: "Ana Lucía", aliases: ["Lu"], iban: MARIA_IBAN }),
      ),
      Story.view(SitterDirectory, HOME, {
        sitters: {
          [anaLucia]: { name: "Ana Lucía", aliases: ["Lu"], iban: MARIA_IBAN, active: true },
        },
        sharedNames: [],
      }),
      Story.view(SitterBalance, Sitter.ref(anaLucia), {
        name: "Ana Lucía",
        active: true,
        balance: 0,
        lastPayment: null,
      }),
    ),
  );

  it.effect("registers a sitter without nicknames or IBAN", () =>
    story(
      sunday,
      asOwner,
      Story.when(anaBook, new RegisterSitter({ name: "Ana" })),
      Story.then(anaBook, new SitterRegistered({ name: "Ana", aliases: [], iban: null })),
    ),
  );

  it.effect("refuses an id that is already registered", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      asOwner,
      Story.when(mariaBook, new RegisterSitter({ name: "Maria" })),
      Story.rejected(new SitterAlreadyRegistered({ sitterId: maria })),
    ),
  );

  it.effect("lets two sitters share a name, and lists it in sharedNames", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      Story.given(anaBook, anaJoined),
      asOwner,
      Story.when(Sitter.ref(maria2), new RegisterSitter({ name: "MARÍA", aliases: ["mari"] })),
      Story.then(
        Sitter.ref(maria2),
        new SitterRegistered({ name: "MARÍA", aliases: ["mari"], iban: null }),
      ),
      Story.view(SitterDirectory, HOME, {
        sharedNames: [
          { name: "Mari", sitterIds: [maria, maria2] },
          { name: "Maria", sitterIds: [maria, maria2] },
        ],
      }),
      Story.when(Sitter.ref(maria2), new UpdateSitter({ name: "Mia", aliases: [] })),
      Story.then(
        Sitter.ref(maria2),
        new SitterDetailsChanged({ name: "Mia", aliases: [], iban: null }),
      ),
      Story.view(SitterDirectory, HOME, { sharedNames: [] }),
    ),
  );

  it.effect("leaves archived sitters out of sharedNames", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, new SitterArchived({})),
      asOwner,
      Story.when(Sitter.ref(maria2), new RegisterSitter({ name: "Maria" })),
      Story.then(
        Sitter.ref(maria2),
        new SitterRegistered({ name: "Maria", aliases: [], iban: null }),
      ),
      Story.view(SitterDirectory, HOME, { sharedNames: [] }),
    ),
  );
});

describe("UpdateSitter", () => {
  it.effect("renames a sitter and replaces their nicknames, keeping their id", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      asOwner,
      Story.when(mariaBook, new UpdateSitter({ name: "María", aliases: ["Mamá"] })),
      Story.then(
        mariaBook,
        new SitterDetailsChanged({ name: "María", aliases: ["Mamá"], iban: MARIA_IBAN }),
      ),
      Story.view(SitterBalance, mariaBook, { name: "María" }),
    ),
  );

  it.effect("removes an IBAN with null", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      asOwner,
      Story.when(mariaBook, new UpdateSitter({ iban: null })),
      Story.then(
        mariaBook,
        new SitterDetailsChanged({ name: "Maria", aliases: ["Mari"], iban: null }),
      ),
    ),
  );

  it.effect("records nothing when nothing changes", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      asOwner,
      Story.when(mariaBook, new UpdateSitter({ name: "Maria", iban: MARIA_IBAN })),
      Story.then(mariaBook),
    ),
  );

  it.effect("refuses an unknown sitter", () =>
    story(
      sunday,
      asOwner,
      Story.when(mariaBook, new UpdateSitter({ name: "Maria" })),
      Story.rejected(new UnknownSitter({ sitterId: maria })),
    ),
  );
});

describe("ArchiveSitter", () => {
  it.effect("archives a sitter who is owed nothing", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined),
      asOwner,
      Story.when(mariaBook, new ArchiveSitter()),
      Story.then(mariaBook, new SitterArchived({})),
      Story.view(SitterBalance, mariaBook, { active: false }),
      Story.view(SitterDirectory, HOME, (directory) => {
        if (directory.sitters[maria]?.active !== false) throw new Error("Maria is still active");
      }),
      Story.when(mariaBook, new ArchiveSitter()),
      Story.then(mariaBook),
    ),
  );

  it.effect("refuses to archive a sitter who is still owed money", () =>
    story(
      sunday,
      Story.given(mariaBook, mariaJoined, sitterRate2026, mariaFriday),
      asOwner,
      Story.when(mariaBook, new ArchiveSitter()),
      Story.rejected(new OutstandingBalance({ sitterId: maria, balance: 6000 })),
    ),
  );

  it.effect("refuses an unknown sitter", () =>
    story(
      sunday,
      asOwner,
      Story.when(mariaBook, new ArchiveSitter()),
      Story.rejected(new UnknownSitter({ sitterId: maria })),
    ),
  );
});
