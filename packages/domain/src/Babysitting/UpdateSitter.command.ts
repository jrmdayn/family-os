import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { Iban } from "./Iban.ts";
import { LedgerId } from "./Ledger.id.ts";
import { NameTaken } from "./NameTaken.rejection.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterName } from "./SitterName.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A sitter's name, nicknames or IBAN changed. Carries the details after the change. */
export class SitterDetailsChanged extends Domain.Event("SitterDetailsChanged", {
  sitterId: SitterId,
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
}) {}

export class UpdateSitter extends Domain.Command(
  "UpdateSitter",
  {
    target: LedgerId,
    middleware: [Session],
    input: {
      sitterId: SitterId,
      name: Schema.optionalKey(SitterName),
      aliases: Schema.optionalKey(Schema.Array(SitterName)),
      iban: Schema.optionalKey(Schema.NullOr(Iban)),
    },
    events: [SitterDetailsChanged],
    rejects: [UnknownSitter, NameTaken],
  },
  {
    description:
      "Change a sitter's name, nicknames (replaces the whole list) or IBAN (null removes it). Fields left out stay as they are. The sitter's id never changes.",
  },
) {}
