import { Story } from "@alchemy.run/domain/Story";
import { describe, it } from "@effect/vitest";
import {
  ArchiveSitter,
  OutstandingBalance,
  SitterArchived,
} from "../src/Babysitting/ArchiveSitter.command.ts";
import { NameTaken } from "../src/Babysitting/NameTaken.rejection.ts";
import {
  RegisterSitter,
  SitterRegistered,
  UnusableName,
} from "../src/Babysitting/RegisterSitter.command.ts";
import { SitterId } from "../src/Babysitting/Sitter.id.ts";
import { SitterBalance } from "../src/Babysitting/SitterBalance.view.ts";
import { SitterDirectory } from "../src/Babysitting/SitterDirectory.view.ts";
import { UnknownSitter } from "../src/Babysitting/UnknownSitter.rejection.ts";
import { SitterDetailsChanged, UpdateSitter } from "../src/Babysitting/UpdateSitter.command.ts";
import {
  ana,
  anaJoined,
  asOwner,
  home,
  maria,
  MARIA_IBAN,
  mariaFriday,
  mariaJoined,
  rate2026,
  story,
  sunday,
} from "./fixtures.ts";

describe("RegisterSitter", () => {
  it.effect("registers a sitter under a slug of their name, with a normalized IBAN", () =>
    story(
      sunday,
      asOwner,
      Story.when(
        home,
        new RegisterSitter({
          name: "Ana Lucía",
          aliases: ["Lu"],
          iban: "fr76 3000 6000 0112 3456 7890 189",
        }),
      ),
      Story.then(
        home,
        new SitterRegistered({
          sitterId: SitterId.make("ana-lucia"),
          name: "Ana Lucía",
          aliases: ["Lu"],
          iban: MARIA_IBAN,
        }),
      ),
      Story.replied({ sitterId: SitterId.make("ana-lucia") }),
      Story.view(SitterDirectory, home, {
        sitters: {
          [SitterId.make("ana-lucia")]: {
            name: "Ana Lucía",
            aliases: ["Lu"],
            iban: MARIA_IBAN,
            active: true,
          },
        },
      }),
      Story.view(SitterBalance, SitterId.make("ana-lucia"), {
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
      Story.when(home, new RegisterSitter({ name: "Ana" })),
      Story.then(
        home,
        new SitterRegistered({ sitterId: ana, name: "Ana", aliases: [], iban: null }),
      ),
      Story.replied({ sitterId: ana }),
    ),
  );

  it.effect("refuses a name or nickname another sitter goes by, whatever the case or accents", () =>
    story(
      sunday,
      Story.given(home, mariaJoined),
      asOwner,
      Story.when(home, new RegisterSitter({ name: "MARIA" })),
      Story.rejected(new NameTaken({ name: "MARIA", takenBy: maria })),
      Story.when(home, new RegisterSitter({ name: "Ana", aliases: ["Mari"] })),
      Story.rejected(new NameTaken({ name: "Mari", takenBy: maria })),
      Story.when(home, new RegisterSitter({ name: "Maria!" })),
      Story.rejected(new NameTaken({ name: "Maria!", takenBy: maria })),
    ),
  );

  it.effect("refuses a name that gives no id", () =>
    story(
      sunday,
      asOwner,
      Story.when(home, new RegisterSitter({ name: "李娜" })),
      Story.rejected(new UnusableName({ name: "李娜" })),
    ),
  );
});

describe("UpdateSitter", () => {
  it.effect("renames a sitter and replaces their nicknames, keeping their id", () =>
    story(
      sunday,
      Story.given(home, mariaJoined),
      asOwner,
      Story.when(home, new UpdateSitter({ sitterId: maria, name: "María", aliases: ["Mamá"] })),
      Story.then(
        home,
        new SitterDetailsChanged({
          sitterId: maria,
          name: "María",
          aliases: ["Mamá"],
          iban: MARIA_IBAN,
        }),
      ),
      Story.view(SitterBalance, maria, { name: "María" }),
    ),
  );

  it.effect("removes an IBAN with null", () =>
    story(
      sunday,
      Story.given(home, mariaJoined),
      asOwner,
      Story.when(home, new UpdateSitter({ sitterId: maria, iban: null })),
      Story.then(
        home,
        new SitterDetailsChanged({ sitterId: maria, name: "Maria", aliases: ["Mari"], iban: null }),
      ),
    ),
  );

  it.effect("records nothing when nothing changes", () =>
    story(
      sunday,
      Story.given(home, mariaJoined),
      asOwner,
      Story.when(home, new UpdateSitter({ sitterId: maria, name: "Maria", iban: MARIA_IBAN })),
      Story.then(home),
    ),
  );

  it.effect("refuses a name another sitter goes by, but not the sitter's own", () =>
    story(
      sunday,
      Story.given(home, mariaJoined, anaJoined),
      asOwner,
      Story.when(home, new UpdateSitter({ sitterId: ana, aliases: ["Mari"] })),
      Story.rejected(new NameTaken({ name: "Mari", takenBy: maria })),
      Story.when(home, new UpdateSitter({ sitterId: maria, aliases: ["Mari", "Mia"] })),
      Story.then(
        home,
        new SitterDetailsChanged({
          sitterId: maria,
          name: "Maria",
          aliases: ["Mari", "Mia"],
          iban: MARIA_IBAN,
        }),
      ),
    ),
  );

  it.effect("refuses an unknown sitter", () =>
    story(
      sunday,
      asOwner,
      Story.when(home, new UpdateSitter({ sitterId: maria, name: "Maria" })),
      Story.rejected(new UnknownSitter({ sitterId: maria })),
    ),
  );
});

describe("ArchiveSitter", () => {
  it.effect("archives a sitter who is owed nothing", () =>
    story(
      sunday,
      Story.given(home, mariaJoined),
      asOwner,
      Story.when(home, new ArchiveSitter({ sitterId: maria })),
      Story.then(home, new SitterArchived({ sitterId: maria })),
      Story.view(SitterBalance, maria, { active: false }),
      Story.view(SitterDirectory, home, (directory) => {
        if (directory.sitters[maria]?.active !== false) throw new Error("Maria is still active");
      }),
      Story.when(home, new ArchiveSitter({ sitterId: maria })),
      Story.then(home),
    ),
  );

  it.effect("refuses to archive a sitter who is still owed money", () =>
    story(
      sunday,
      Story.given(home, rate2026, mariaJoined, mariaFriday),
      asOwner,
      Story.when(home, new ArchiveSitter({ sitterId: maria })),
      Story.rejected(new OutstandingBalance({ sitterId: maria, balance: 6000 })),
    ),
  );

  it.effect("refuses an unknown sitter", () =>
    story(
      sunday,
      asOwner,
      Story.when(home, new ArchiveSitter({ sitterId: maria })),
      Story.rejected(new UnknownSitter({ sitterId: maria })),
    ),
  );
});
