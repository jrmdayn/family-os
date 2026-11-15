import * as Domain from "@alchemy.run/domain";
import * as Schema from "effect/Schema";
import { SitterId } from "./Sitter.id.ts";

export class NameTaken extends Domain.Rejection(
  "NameTaken",
  { name: Schema.String, takenBy: SitterId },
  { description: "Another sitter already goes by this name or nickname." },
) {}
