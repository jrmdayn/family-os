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
