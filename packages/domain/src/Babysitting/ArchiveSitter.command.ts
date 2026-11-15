import * as Domain from "@alchemy.run/domain";
import { Cents } from "../Money.ts";
import { Session } from "../Session.middleware.ts";
import { SitterId } from "./Sitter.id.ts";
import { UnknownSitter } from "./UnknownSitter.rejection.ts";

/** A sitter stopped babysitting, with nothing owed either way. */
export class SitterArchived extends Domain.Event("SitterArchived", {}) {}

export class OutstandingBalance extends Domain.Rejection(
  "OutstandingBalance",
  { sitterId: SitterId, balance: Cents },
  { description: "The sitter's balance isn't zero. Settle it before archiving." },
) {}

export class ArchiveSitter extends Domain.Command(
  "ArchiveSitter",
  {
    target: SitterId,
    middleware: [Session],
    events: [SitterArchived],
    rejects: [UnknownSitter, OutstandingBalance],
  },
  {
    description:
      "Archive a sitter who no longer babysits. Their balance must be zero. Their history stays readable, and household rate changes no longer reach them.",
  },
) {}
