import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { Iban } from "./Iban.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterName } from "./SitterName.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A sitter's name, nicknames or IBAN changed. Carries the details after the change. */
export class SitterDetailsChanged extends Domain.Event("SitterDetailsChanged", {
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
}) {}

export class UpdateSitter extends Domain.Command(
  "UpdateSitter",
  {
    target: SitterId,
    middleware: [Session],
    input: {
      name: Schema.optionalKey(SitterName),
      aliases: Schema.optionalKey(Schema.Array(SitterName)),
      iban: Schema.optionalKey(Schema.NullOr(Iban)),
    },
    events: [SitterDetailsChanged],
    rejects: [UnknownSitter],
    reply: {
      name: Schema.String,
      aliases: Schema.Array(Schema.String),
      iban: Schema.NullOr(Schema.String),
    },
  },
  {
    description:
      "Change a sitter's name, nicknames (replaces the whole list) or IBAN (null removes it). Fields left out stay as they are. The sitter's id never changes. Replies with the sitter's details after the change: name, nicknames, and IBAN as stored (upper case, no spaces) or null.",
  },
) {}
