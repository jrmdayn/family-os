/**
 * Imports the Notion babysitting database (its CSV export) into Family OS.
 *
 *   pnpm import-notion export-2023.csv export-2024.csv
 *       Dry run: replays the history into a model in memory and prints each
 *       sitter's balance next to Notion's. Nothing leaves this machine.
 *
 *   pnpm import-notion export-2023.csv export-2024.csv --into https://family-os-dev.jrmdayn.workers.dev
 *       Replays it into a deployed stage, with FAMILY_OS_TOKEN as the bearer
 *       token. Running it again resumes: each command has a fixed commandId.
 *
 * The export holds people's names and pay, so keep it out of the repository.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import * as Domain from "@alchemy.run/domain";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { owner } from "@family-os/domain/Actor";
import { FamilyOs, FamilyOsHandlers } from "@family-os/domain/FamilyOs.model";
import { OwnerApi } from "@family-os/domain/OwnerApi.api";
import { sessionClient } from "@family-os/domain/Session.middleware";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as References from "effect/References";
import {
  balancesMatch,
  formatResult,
  planImport,
  readNotionCsv,
  replay,
  type OwnerClient,
  type SitterResult,
} from "./NotionImport.ts";
import { OwnerToken, SessionLive } from "./Session.ts";

const args = process.argv.slice(2);
const intoAt = args.indexOf("--into");
const into = intoAt >= 0 ? args[intoAt + 1] : undefined;
const files = args.filter((arg, i) => !arg.startsWith("--") && (intoAt < 0 || i !== intoAt + 1));
if (files.length === 0 || (intoAt >= 0 && !into)) {
  console.error("Usage: pnpm import-notion <export.csv>... [--into <url>]");
  process.exit(2);
}

const rows = files.flatMap((file) => readNotionCsv(basename(file), readFileSync(file, "utf8")));
const plan = planImport(rows);

const progress = (sitter: SitterResult) =>
  Console.log(`  ${sitter.name}: ${sitter.shifts} shifts replayed`);

const run = (api: OwnerClient) =>
  Effect.gen(function* () {
    yield* Console.log(
      `${rows.length} rows from ${files.length} file(s): ${plan.sitters.length} sitters, ${plan.rates.length} rates.`,
    );
    yield* Console.log(into ? `Importing into ${into}…` : "Dry run, in memory…");
    const result = yield* replay(api, plan, progress);
    yield* Console.log(`\n${formatResult(result)}`);
    if (!balancesMatch(result)) process.exitCode = 1;
  });

const DRY_RUN_TOKEN = "notion-import-dry-run-token-0123456789";

/** The whole model in memory, as in the dev server: nothing is written anywhere. */
const InMemory = SessionLive.pipe(
  Layer.provideMerge(FamilyOs.layer(FamilyOsHandlers).pipe(Layer.provide(Domain.InMemory))),
  Layer.provide(
    Layer.succeed(OwnerToken, {
      token: Redacted.make(DRY_RUN_TOKEN),
      actor: owner("notion-import"),
    }),
  ),
);

const program = into
  ? Effect.gen(function* () {
      const token = process.env.FAMILY_OS_TOKEN;
      if (!token)
        return yield* Effect.die(new Error("Set FAMILY_OS_TOKEN to import into a stage."));
      const api = yield* OwnerApi.clientHttp(`${into.replace(/\/$/, "")}/rpc`).pipe(
        Effect.provide(sessionClient(token)),
      );
      yield* run(api);
    }).pipe(Effect.scoped, Effect.provide(FetchHttpClient.layer))
  : Effect.gen(function* () {
      const api = yield* OwnerApi.clientInProcess.pipe(
        Effect.provide(sessionClient(DRY_RUN_TOKEN)),
      );
      yield* run(api);
    }).pipe(Effect.scoped, Effect.provide(InMemory));

program.pipe(
  // The engine logs every view rebuild at Info; keep the terminal for the report.
  Effect.provide(Layer.succeed(References.MinimumLogLevel, "Warn")),
  NodeRuntime.runMain,
);
