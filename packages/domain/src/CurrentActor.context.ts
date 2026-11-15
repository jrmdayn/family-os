import * as Domain from "@alchemy.run/domain";
import { Actor } from "./Actor.ts";

/**
 * Who is making the current request. `Session` provides it to every command
 * and read. Senders without a session (scripts, tests) provide it themselves.
 */
export class CurrentActor extends Domain.RequestContext<CurrentActor>()(
  "FamilyOs/CurrentActor",
  Actor,
) {}
