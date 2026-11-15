import * as Schema from "effect/Schema";

/**
 * Who is acting. The session middleware provides it as the `CurrentActor` of
 * each request: the household's owner, signed in, or the system (scripts such
 * as the Notion import).
 */
export const Actor = Schema.Union([
  Schema.TaggedStruct("Owner", { email: Schema.String }),
  Schema.TaggedStruct("System", { name: Schema.String }),
]);
export type Actor = typeof Actor.Type;

export const owner = (email: string): Actor => ({ _tag: "Owner", email });
export const system = (name: string): Actor => ({ _tag: "System", name });
