import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { Iban } from "./Iban.ts";
import { LedgerId } from "./Ledger.id.ts";
import { NameTaken } from "./NameTaken.rejection.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterName } from "./SitterName.ts";

/** A new babysitter joined. */
export class SitterRegistered extends Domain.Event("SitterRegistered", {
  sitterId: SitterId,
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
}) {}

export class UnusableName extends Domain.Rejection(
  "UnusableName",
  { name: Schema.String },
  { description: "The name has no letter (a–z, accents allowed) or digit to build an id from." },
) {}

export class RegisterSitter extends Domain.Command(
  "RegisterSitter",
  {
    target: LedgerId,
    middleware: [Session],
    input: {
      name: SitterName,
      aliases: Schema.optionalKey(Schema.Array(SitterName)),
      iban: Schema.optionalKey(Iban),
    },
    events: [SitterRegistered],
    rejects: [NameTaken, UnusableName],
    reply: { sitterId: SitterId },
  },
  {
    description:
      "Register a new babysitter with the name they go by, optional nicknames, and optionally the IBAN their pay is wired to. Replies with their id, a slug of the name. Names and nicknames must be unique across sitters.",
  },
) {}
