import * as Headers from "effect/http/Headers";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
import * as Schema from "effect/Schema";
import { CurrentActor } from "./CurrentActor.context.ts";

/** The request carries no valid session. Over plain HTTP, a 401. */
export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  {},
  { httpApiStatus: 401 },
) {}

/**
 * Authenticates a request and provides who made it as the
 * {@link CurrentActor}. The server package implements it; every command and
 * read the Api serves lists it.
 */
export class Session extends RpcMiddleware.Service<Session, { provides: CurrentActor }>()(
  "FamilyOs/Session",
  { error: Unauthorized },
) {}

/** Client side, for clients that are not browsers: send this token with every call. */
export const sessionClient = (token: string) =>
  RpcMiddleware.layerClient(Session, ({ request, next }) =>
    next({ ...request, headers: Headers.set(request.headers, "authorization", `Bearer ${token}`) }),
  );
