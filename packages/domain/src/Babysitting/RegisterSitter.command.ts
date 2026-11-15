import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { Session } from "../Session.middleware.ts";
import { Iban } from "./Iban.ts";
import { SitterId } from "./Sitter.id.ts";
import { SitterName } from "./SitterName.ts";

/** A new babysitter joined. */
export class SitterRegistered extends Domain.Event("SitterRegistered", {
  name: Schema.String,
  aliases: Schema.Array(Schema.String),
  iban: Schema.NullOr(Schema.String),
}) {}

export class SitterAlreadyRegistered extends Domain.Rejection(
  "SitterAlreadyRegistered",
  { sitterId: SitterId },
  {
    description:
      "A sitter with this id is already registered. Pick another id (e.g. maria-2) for a different person.",
  },
) {}

export class RegisterSitter extends Domain.Command(
  "RegisterSitter",
  {
    target: SitterId,
    middleware: [Session],
    input: {
      name: SitterName,
      aliases: Schema.optionalKey(Schema.Array(SitterName)),
      iban: Schema.optionalKey(Iban),
    },
    events: [SitterRegistered],
    rejects: [SitterAlreadyRegistered],
  },
  {
    description:
      'Register a new babysitter. Target: their new id, a slug of their name ("Ana Lucía" is "ana-lucia"). Give the name they go by, optional nicknames, and optionally the IBAN their pay is wired to. They get the household\'s hourly rates a moment later. Two sitters may share a name or nickname: SitterDirectory lists those in sharedNames.',
  },
) {}
