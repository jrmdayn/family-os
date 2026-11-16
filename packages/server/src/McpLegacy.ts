/**
 * Serves MCP clients that speak a 2024–2025 revision of the protocol
 * (Gemini, older Claude clients, most SDKs) from the sessionless
 * `2026-07-28` server, without keeping any state between requests.
 *
 * Those revisions start with an `initialize` handshake, then send requests
 * without the `2026-07-28` headers and `_meta`. Streamable HTTP lets a server
 * not issue a session id, so each request here stands alone:
 *
 * - `initialize` is answered here, with the capabilities and instructions
 *   the real server reports (`server/discover`), and no `Mcp-Session-Id`;
 * - notifications (`notifications/initialized`, ...) are accepted with `202`;
 * - `ping` is answered here;
 * - every other request (`tools/list`, `tools/call`, ...) is rewritten into
 *   its `2026-07-28` form and run by the real server. Its result carries a
 *   few fields older clients don't know (`resultType`, `ttlMs`), which they
 *   ignore.
 *
 * The Worker can't hold an MCP session open, which is why this exists rather
 * than Effect's sessionful `layerHttp`. See the decisions page.
 */
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

/** The revision the real server speaks. */
const CURRENT = "2026-07-28";

/** The revisions bridged here, newest first: the first is offered to clients asking for another. */
export const LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

type JsonRpcMessage = {
  readonly jsonrpc?: unknown;
  readonly id?: string | number | null;
  readonly method?: unknown;
  readonly params?: Record<string, unknown>;
};

/** A request is for the bridge unless it says it speaks `2026-07-28`. */
export const isLegacyRequest = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["mcp-protocol-version"] !== CURRENT;

const error = (id: JsonRpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

/** The `_meta` a `2026-07-28` request must carry. A legacy client said who it was only in `initialize`. */
const meta = (request: HttpServerRequest.HttpServerRequest) => ({
  "io.modelcontextprotocol/protocolVersion": CURRENT,
  "io.modelcontextprotocol/clientInfo": {
    name: request.headers["user-agent"] ?? "mcp-client",
    version: "0",
  },
  "io.modelcontextprotocol/clientCapabilities": {},
});

/** The `Mcp-Name` header `2026-07-28` routes some methods by. */
const nameOf = (message: JsonRpcMessage): string | undefined => {
  const params = message.params ?? {};
  if (message.method === "tools/call" || message.method === "prompts/get") {
    return typeof params["name"] === "string" ? params["name"] : undefined;
  }
  if (message.method === "resources/read") {
    return typeof params["uri"] === "string" ? params["uri"] : undefined;
  }
  return undefined;
};

/**
 * Wraps the `2026-07-28` endpoint so legacy requests are bridged. `endpoint`
 * runs with the `HttpServerRequest` in context, as the route handler does.
 */
export const bridgeLegacyMcp = <E, R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!isLegacyRequest(request)) return yield* endpoint;

    // No server-to-client stream and no sessions to end: POST only.
    if (request.method !== "POST") {
      return HttpServerResponse.empty({ status: 405, headers: { allow: "POST" } });
    }

    /** Runs one `2026-07-28` request on the real server and returns its JSON-RPC reply. */
    const forward = (message: JsonRpcMessage) =>
      Effect.gen(function* () {
        const headers = new Headers({
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": CURRENT,
          "mcp-method": String(message.method),
        });
        const name = nameOf(message);
        if (name !== undefined) headers.set("mcp-name", name);
        for (const header of ["authorization", "cookie", "user-agent"]) {
          const value = request.headers[header];
          if (value !== undefined) headers.set(header, value);
        }
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          method: message.method,
          params: {
            ...message.params,
            _meta: { ...(message.params?.["_meta"] as object | undefined), ...meta(request) },
          },
        });
        const inner = HttpServerRequest.fromWeb(
          new Request(new URL(request.url, "http://mcp.local"), { method: "POST", headers, body }),
        );
        const response = yield* Effect.provideService(
          endpoint,
          HttpServerRequest.HttpServerRequest,
          inner,
        );
        const web = HttpServerResponse.toWeb(response);
        const text = yield* Effect.promise(() => web.text());
        return JSON.parse(text) as { result?: Record<string, unknown>; error?: unknown };
      });

    const answer = (message: JsonRpcMessage) =>
      Effect.gen(function* () {
        if (typeof message !== "object" || message === null || typeof message.method !== "string") {
          return error(null, -32600, "Invalid request");
        }
        // A notification gets no reply.
        if (message.id === undefined) return undefined;
        switch (message.method) {
          case "initialize": {
            const asked = message.params?.["protocolVersion"];
            const protocolVersion =
              LEGACY_VERSIONS.find((version) => version === asked) ?? LEGACY_VERSIONS[0];
            const discovered = yield* forward({
              id: message.id,
              method: "server/discover",
              params: {},
            });
            if (discovered.result === undefined)
              return { jsonrpc: "2.0", id: message.id, error: discovered.error };
            const { capabilities, instructions, _meta } = discovered.result as {
              capabilities?: unknown;
              instructions?: unknown;
              _meta?: Record<string, unknown>;
            };
            return {
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion,
                capabilities,
                serverInfo: _meta?.["io.modelcontextprotocol/serverInfo"],
                ...(instructions === undefined ? {} : { instructions }),
              },
            };
          }
          case "ping":
            return { jsonrpc: "2.0", id: message.id, result: {} };
          default:
            return yield* forward(message);
        }
      });

    const body = yield* request.json.pipe(Effect.orElseSucceed(() => undefined));
    if (body === undefined)
      return HttpServerResponse.jsonUnsafe(error(null, -32700, "Parse error"), { status: 400 });

    // 2025-03-26 allowed batches: answer each message, in order.
    if (Array.isArray(body)) {
      const replies: Array<unknown> = [];
      for (const message of body as Array<JsonRpcMessage>) {
        const reply = yield* answer(message);
        if (reply !== undefined) replies.push(reply);
      }
      return replies.length === 0
        ? HttpServerResponse.empty({ status: 202 })
        : HttpServerResponse.jsonUnsafe(replies);
    }
    const reply = yield* answer(body as JsonRpcMessage);
    return reply === undefined
      ? HttpServerResponse.empty({ status: 202 })
      : HttpServerResponse.jsonUnsafe(reply);
  });
