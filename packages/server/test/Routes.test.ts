import * as Domain from "@alchemy.run/domain";
import { expect, it } from "@effect/vitest";
import { owner } from "@family-os/domain/Actor";
import { HOME } from "@family-os/domain/Babysitting/Household";
import { SitterId } from "@family-os/domain/Babysitting/Sitter.id";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { OwnerApi } from "@family-os/domain/OwnerApi.api";
import { sessionClient } from "@family-os/domain/Session.middleware";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import { ModelRoutes } from "../src/Routes.ts";
import { OwnerToken, SessionLive } from "../src/Session.ts";

/**
 * The routes the Worker serves, over HTTP, with the model in memory: what
 * changes on Cloudflare is only where the model is hosted.
 */
const TOKEN = "a-test-token-that-is-long-enough!";

const World = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provide(
    Layer.succeed(OwnerToken, { token: Redacted.make(TOKEN), actor: owner("me@x.fr") }),
  ),
);

/** A server answering in process, like the Worker: `fetch(path, init)` returns its response. */
const serve = Effect.gen(function* () {
  const { handler, dispose } = HttpRouter.toWebHandler(ModelRoutes.pipe(Layer.provide(World)), {
    disableLogger: true,
  });
  yield* Effect.addFinalizer(() => Effect.promise(dispose));
  const fetch = (path: string, init: RequestInit = {}) =>
    Effect.promise(() => handler(new Request(`http://localhost${path}`, init)));
  /** An HTTP client whose requests reach this server, for the typed client. */
  const client = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, ((input, init) =>
        handler(new Request(input, init))) as typeof globalThis.fetch),
    ),
  );
  return { fetch, client };
});

const json = (body: unknown, token?: string) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify(body),
});

const maria = SitterId.make("maria");

it.live("/rpc serves the typed client, as `fos` uses it", () =>
  Effect.gen(function* () {
    const { client } = yield* serve;
    const api = yield* OwnerApi.client.pipe(
      Effect.provide(
        Layer.mergeAll(Domain.protocolHttp("http://localhost/rpc"), sessionClient(TOKEN)).pipe(
          Layer.provide(client),
        ),
      ),
    );
    const set = yield* api.SetHourlyRate(HOME, { centsPerHour: 1500, effectiveFrom: "2026-01-01" });
    expect(set.reply).toEqual({ centsPerHour: 1500, effectiveFrom: "2026-01-01" });
    const rates = yield* api.HourlyRates.get(HOME, { atLeast: set });
    expect(rates).toMatchObject({ rates: [{ centsPerHour: 1500, effectiveFrom: "2026-01-01" }] });
  }).pipe(Effect.scoped),
);

it.live("/api serves plain HTTP with the owner's token, and answers 401 without it", () =>
  Effect.gen(function* () {
    const { fetch } = yield* serve;
    const rate = { target: HOME, input: { centsPerHour: 1500, effectiveFrom: "2026-01-01" } };

    const anonymous = yield* fetch("/api/SetHourlyRate", json(rate));
    expect(anonymous.status).toBe(401);
    const wrong = yield* fetch("/api/SetHourlyRate", json(rate, "not-the-token"));
    expect(wrong.status).toBe(401);

    const set = yield* fetch("/api/SetHourlyRate", json(rate, TOKEN));
    expect(set.status).toBe(200);
    expect(yield* Effect.promise(() => set.json())).toMatchObject({
      reply: { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
      stream: "RateCard/home",
    });

    // A rejection answers 422 with its tag and data.
    const refused = yield* fetch(
      "/api/LogShift",
      json({ target: maria, input: { date: "2026-11-13", minutes: 60 } }, TOKEN),
    );
    expect(refused.status).toBe(422);
    expect(yield* Effect.promise(() => refused.json())).toEqual({
      _tag: "UnknownSitter",
      sitterId: "maria",
    });
  }).pipe(Effect.scoped),
);

it.live("/api/openapi.json describes every call, with its description for an LLM", () =>
  Effect.gen(function* () {
    const { fetch } = yield* serve;
    const response = yield* fetch("/api/openapi.json");
    expect(response.status).toBe(200);
    const spec = (yield* Effect.promise(() => response.json())) as {
      info: { title: string };
      paths: Record<string, Record<string, { description?: string }>>;
    };
    expect(spec.info.title).toBe("Family OS");
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/api/ArchiveSitter",
      "/api/CancelPayment",
      "/api/CancelShift",
      "/api/CorrectShift",
      "/api/HourlyRates/{key}",
      "/api/LogShift",
      "/api/Payouts/{key}",
      "/api/RecordPayment",
      "/api/RegisterSitter",
      "/api/SetHourlyRate",
      "/api/SetSitterRate",
      "/api/SitterBalance/{key}",
      "/api/SitterDirectory/{key}",
      "/api/SitterStatement/{key}/list",
      "/api/UpdateSitter",
    ]);
    expect(spec.paths["/api/LogShift"]?.post?.description).toContain("Maria 4h on Friday");
  }).pipe(Effect.scoped),
);

/** One sessionless MCP request (protocol `2026-07-28`), as Claude sends it. */
const mcp = (method: string, params: object, token?: string) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": method,
    ...("name" in params ? { "mcp-name": String(params.name) } : {}),
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": {},
      },
      ...params,
    },
  }),
});

it.live("/mcp serves every call as a tool, signed in with the owner's token", () =>
  Effect.gen(function* () {
    const { fetch } = yield* serve;
    const call = (name: string, args: object, token?: string) =>
      fetch("/mcp", mcp("tools/call", { name, arguments: args }, token)).pipe(
        Effect.flatMap((response) => Effect.promise(() => response.json())),
        Effect.map((body) => (body as { result: any }).result),
      );

    const listed = yield* fetch("/mcp", mcp("tools/list", {}, TOKEN)).pipe(
      Effect.flatMap((response) => Effect.promise(() => response.json())),
    );
    const tools = (listed as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools.map((tool) => tool.name)).toContain("OwnerApi_LogShift_send");
    expect(tools).toHaveLength(15);

    // Without a token, /mcp answers 401 before any tool runs: that starts an OAuth sign-in.
    const anonymous = yield* fetch(
      "/mcp",
      mcp("tools/call", { name: "OwnerApi_Payouts_get", arguments: { key: HOME } }),
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe("Bearer");

    // A household view reads null until something reaches it; its description says so.
    const fresh = yield* call("OwnerApi_Payouts_get", { key: HOME }, TOKEN);
    expect(fresh.structuredContent).toEqual({ value: null });

    yield* call(
      "OwnerApi_SetHourlyRate_send",
      { target: HOME, input: { centsPerHour: 1500, effectiveFrom: "2026-01-01" } },
      TOKEN,
    );
    const registered = yield* call(
      "OwnerApi_RegisterSitter_send",
      { target: maria, input: { name: "Maria", iban: "FR76 3000 6000 0112 3456 7890 189" } },
      TOKEN,
    );
    expect(registered.structuredContent).toEqual({
      reply: { name: "Maria", aliases: [], iban: "FR7630006000011234567890189" },
      stream: "Sitter/maria",
      version: 1,
    });
    // The household rate reaches a new sitter a moment after they register.
    const logged = yield* call(
      "OwnerApi_LogShift_send",
      { target: maria, input: { date: "2026-11-13", minutes: 240 } },
      TOKEN,
    ).pipe(
      Effect.repeat({
        until: (result) => !result.isError,
        schedule: Schedule.spaced("10 millis"),
        times: 100,
      }),
    );
    expect(logged.structuredContent).toMatchObject({
      reply: { amount: 6000, balance: 6000 },
      stream: "Sitter/maria",
    });
  }).pipe(Effect.scoped),
);

/** A request from a client on a 2025 revision: no `2026-07-28` headers, no `_meta`. */
const legacy = (body: unknown, token?: string, version?: string) => ({
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(version === undefined ? {} : { "mcp-protocol-version": version }),
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
  },
  body: JSON.stringify(body),
});

it.live("/mcp bridges clients on a 2025 revision, without sessions", () =>
  Effect.gen(function* () {
    const { fetch } = yield* serve;
    const json = (response: Response) => Effect.promise(() => response.json() as Promise<any>);

    // initialize is answered with the revision asked for, the real capabilities, and no session.
    const init = yield* fetch(
      "/mcp",
      legacy(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "gemini", version: "1" },
          },
        },
        TOKEN,
      ),
    );
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    const initialized = yield* json(init);
    expect(initialized.result).toMatchObject({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "family-os" },
    });
    expect(initialized.result.instructions).toContain("babysitting");

    // An unknown revision is offered the newest bridged one.
    const unknown = yield* json(
      yield* fetch(
        "/mcp",
        legacy(
          {
            jsonrpc: "2.0",
            id: 2,
            method: "initialize",
            params: { protocolVersion: "2099-01-01" },
          },
          TOKEN,
        ),
      ),
    );
    expect(unknown.result.protocolVersion).toBe("2025-11-25");

    const notified = yield* fetch(
      "/mcp",
      legacy({ jsonrpc: "2.0", method: "notifications/initialized" }, TOKEN, "2025-06-18"),
    );
    expect(notified.status).toBe(202);

    const listed = yield* json(
      yield* fetch(
        "/mcp",
        legacy({ jsonrpc: "2.0", id: 3, method: "tools/list" }, TOKEN, "2025-06-18"),
      ),
    );
    expect(listed.result.tools).toHaveLength(15);

    const set = yield* json(
      yield* fetch(
        "/mcp",
        legacy(
          {
            jsonrpc: "2.0",
            id: 4,
            method: "tools/call",
            params: {
              name: "OwnerApi_SetHourlyRate_send",
              arguments: {
                target: HOME,
                input: { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
              },
            },
          },
          TOKEN,
          "2025-06-18",
        ),
      ),
    );
    expect(set).toMatchObject({ jsonrpc: "2.0", id: 4 });
    expect(set.result.structuredContent).toMatchObject({
      reply: { centsPerHour: 1500, effectiveFrom: "2026-01-01" },
    });

    // 2025-03-26 batches: one reply per request, in order, none for notifications.
    const batch = yield* json(
      yield* fetch(
        "/mcp",
        legacy(
          [
            { jsonrpc: "2.0", id: 5, method: "ping" },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            { jsonrpc: "2.0", id: 6, method: "tools/list" },
          ],
          TOKEN,
        ),
      ),
    );
    expect(batch.map((reply: { id: number }) => reply.id)).toEqual([5, 6]);

    // No server-to-client stream: GET is not allowed. And without a token, still 401.
    const get = yield* fetch("/mcp", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(get.status).toBe(405);
    const anonymous = yield* fetch("/mcp", legacy({ jsonrpc: "2.0", id: 7, method: "tools/list" }));
    expect(anonymous.status).toBe(401);
  }).pipe(Effect.scoped),
);
