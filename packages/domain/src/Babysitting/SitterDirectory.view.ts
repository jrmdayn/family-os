import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { HOME, Household } from "./Household.ts";
import { anySignedInCaller } from "./signedIn.ts";
import { Sitter } from "./Sitter.aggregate.ts";
import { SitterId } from "./Sitter.id.ts";
import { nameKey } from "./SitterName.ts";

const Entry = Schema.Struct({
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
  active: Schema.Boolean,
});
type Entry = typeof Entry.Type;

const SharedName = Schema.Struct({ name: Schema.String, sitterIds: Schema.Array(SitterId) });

const DirectoryState = Schema.Struct({
  sitters: Schema.Record(SitterId, Entry),
  sharedNames: Schema.Array(SharedName),
});
type DirectoryState = typeof DirectoryState.Type;

/**
 * The names that more than one active sitter goes by, ignoring case and
 * accents. Names aren't unique, so a lookup by one of these must ask which
 * sitter was meant.
 */
const sharedNamesOf = (sitters: DirectoryState["sitters"]): DirectoryState["sharedNames"] => {
  const byName = new Map<string, { name: string; sitterIds: Array<SitterId> }>();
  for (const [sitterId, entry] of Object.entries(sitters) as Array<[SitterId, Entry]>) {
    if (!entry.active) continue;
    const keys = new Set<string>();
    for (const name of [entry.name, ...entry.aliases]) {
      const key = nameKey(name);
      if (keys.has(key)) continue;
      keys.add(key);
      const group = byName.get(key) ?? { name, sitterIds: [] };
      group.sitterIds.push(sitterId);
      byName.set(key, group);
    }
  }
  return [...byName.values()]
    .filter((group) => group.sitterIds.length > 1)
    .map((group) => ({ name: group.name, sitterIds: group.sitterIds.toSorted() }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
};

const withSitters = (sitters: DirectoryState["sitters"]): DirectoryState => ({
  sitters,
  sharedNames: sharedNamesOf(sitters),
});

const updated = (v: DirectoryState, sitterId: SitterId, update: (entry: Entry) => Entry) => {
  const entry = v.sitters[sitterId];
  return entry ? withSitters({ ...v.sitters, [sitterId]: update(entry) }) : v;
};

/** Every sitter: who they are, the names they go by, and where to wire their pay. */
export class SitterDirectory extends Domain.View(
  "SitterDirectory",
  {
    from: [Sitter],
    key: Household,
    keyOf: { Sitter: () => HOME },
    middleware: [Session],
    state: DirectoryState,
    initial: { sitters: {}, sharedNames: [] },
    evolve: {
      SitterRegistered: (v, e, { source }) =>
        withSitters({
          ...v.sitters,
          [source.id]: { name: e.name, aliases: e.aliases, iban: e.iban, active: true },
        }),
      SitterDetailsChanged: (v, e, { source }) =>
        updated(v, source.id, (entry) => ({
          ...entry,
          name: e.name,
          aliases: e.aliases,
          iban: e.iban,
        })),
      SitterArchived: (v, _, { source }) =>
        updated(v, source.id, (entry) => ({ ...entry, active: false })),
      // Every other sitter event changes nothing here, but taking it moves the view
      // past it, so a read `atLeast` any sitter command's receipt returns.
      Sitter: (v) => v,
    },
    // 1: takes every sitter event.
    version: 1,
  },
  {
    description:
      'Every sitter by id, with their name, nicknames, IBAN and whether they are active. Use it to turn a name like "Maria" into a sitter id. Names are not unique: sharedNames lists every name (or nickname) more than one active sitter goes by, ignoring case and accents; when the name you look up is one of them, ask which sitter is meant. Key: always "home". The value is null until the first sitter is registered: null means no sitters yet, not an error.',
  },
) {}

export const SitterDirectoryLive = SitterDirectory.toLayer(anySignedInCaller);
