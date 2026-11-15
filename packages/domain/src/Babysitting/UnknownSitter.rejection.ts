import * as Domain from "@alchemy.run/domain";
import { SitterId } from "./Sitter.id.ts";

export class UnknownSitter extends Domain.Rejection(
  "UnknownSitter",
  { sitterId: SitterId },
  { description: "No sitter has this id. Look the sitter up in SitterDirectory." },
) {}
