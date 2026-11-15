import * as Domain from "@alchemy.run/domain";
import { SitterId } from "./Sitter.id.ts";

export class SitterNotActive extends Domain.Rejection(
  "SitterNotActive",
  { sitterId: SitterId },
  { description: "The sitter is archived: their ledger is closed." },
) {}
