import * as Domain from "@alchemy.run/domain";
import { FamilyOs } from "./FamilyOs.model.ts";

/** What the household's owner reaches, from the web app, the CLI or an LLM over MCP. */
export class OwnerApi extends Domain.Api(
  "OwnerApi",
  {
    model: FamilyOs,
    commands: [
      "SetHourlyRate",
      "SetSitterRate",
      "RegisterSitter",
      "UpdateSitter",
      "ArchiveSitter",
      "LogShift",
      "CorrectShift",
      "CancelShift",
      "RecordPayment",
      "CancelPayment",
    ],
    views: ["SitterDirectory", "HourlyRates", "SitterBalance", "SitterStatement", "Payouts"],
  },
  {
    description:
      'Family OS: the household\'s babysitting ledger. Amounts are euro cents, durations minutes, dates YYYY-MM-DD in Europe/Paris. Each sitter has their own book: commands about a sitter target their id (find it in SitterDirectory), and SetHourlyRate targets the household, "home". What to wire is in Payouts.',
  },
) {}

/**
 * The calls the owner reaches from outside the app: the CLI, the plain HTTP
 * Api and the MCP tools publish exactly these. Each command, and each view's
 * read that returns once.
 */
export const ownerCalls = [
  "SetHourlyRate",
  "SetSitterRate",
  "RegisterSitter",
  "UpdateSitter",
  "ArchiveSitter",
  "LogShift",
  "CorrectShift",
  "CancelShift",
  "RecordPayment",
  "CancelPayment",
  "SitterDirectory.get",
  "HourlyRates.get",
  "SitterBalance.get",
  "SitterStatement.list",
  "Payouts.get",
] as const;
