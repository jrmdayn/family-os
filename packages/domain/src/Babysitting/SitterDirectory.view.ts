import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { Ledger } from "./Ledger.aggregate.ts";
import { anySignedInCaller } from "./signedIn.ts";
import { SitterId } from "./Sitter.id.ts";

const Entry = Schema.Struct({
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
});

/** Every sitter: who they are, the names they go by, and where to wire their pay. */
export class SitterDirectory extends Domain.View(
  "SitterDirectory",
  {
    from: [Ledger],
    key: Ledger,
    middleware: [Session],
    state: Schema.Struct({ sitters: Schema.Record(SitterId, Entry) }),
    initial: { sitters: {} },
    evolve: {
      SitterRegistered: (v, e) => ({
        sitters: {
          ...v.sitters,
          [e.sitterId]: { name: e.name, aliases: e.aliases, iban: e.iban, active: true },
        },
      }),
      SitterDetailsChanged: (v, e) => {
        const sitter = v.sitters[e.sitterId];
        if (!sitter) return v;
        return {
          sitters: {
            ...v.sitters,
            [e.sitterId]: { ...sitter, name: e.name, aliases: e.aliases, iban: e.iban },
          },
        };
      },
      SitterArchived: (v, e) => {
        const sitter = v.sitters[e.sitterId];
        if (!sitter) return v;
        return { sitters: { ...v.sitters, [e.sitterId]: { ...sitter, active: false } } };
      },
    },
  },
  {
    description:
      'Every sitter by id, with their name, nicknames, IBAN and whether they are active. Use it to turn a name like "Maria" into a sitter id. Key: always "home".',
  },
) {}

export const SitterDirectoryLive = SitterDirectory.toLayer(anySignedInCaller);
