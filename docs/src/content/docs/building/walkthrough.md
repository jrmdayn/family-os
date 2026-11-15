---
title: "Walkthrough: Maria 4h on Friday"
description: Connect Claude Code to the dev stage, then follow one conversation from setting the rate to paying Maria, with every tool call and its result.
---

This page follows one conversation end to end: set the household rate, register Maria, "Maria 4h on Friday", "What do I need to wire to whom?", "I paid Maria". For each step it shows the tool Claude calls, its arguments and the result Family OS sends back.

The results below are real: they were recorded on Sunday 15 November 2026 against the local dev server, by sending the same MCP requests Claude sends (see [Call a tool without Claude](#call-a-tool-without-claude)). A deployed stage answers with the same shapes; on a stage that already holds data, `version` numbers and balances differ. Claude's own words vary from one run to the next, so this page describes what Claude does with each result rather than quoting it.

## Connect Claude Code to dev

You need the owner token, `FAMILY_OS_TOKEN`:

- On the owner's laptop, `pnpm stacks:github:reveal` prints it (see [Deploy credentials](/building/deploy-credentials/#give-claude-code-cloud-sessions-their-token)).
- In a Claude Code cloud session, it is already in the environment.

The `dev` stage must have been deployed at least once: run CI's `deploy-dev` job, or `pnpm deploy:dev` (see [Deploying](/building/deploying/#stages)). Then add it as an MCP server:

```sh
claude mcp add --transport http family-os https://family-os-dev.jrmdayn.workers.dev/mcp \
  --header "Authorization: Bearer $FAMILY_OS_TOKEN"
```

The shell expands `$FAMILY_OS_TOKEN` when you run the command, so Claude Code stores the value. `claude mcp get family-os` should report it as connected. The server offers 15 tools, one per command and read of the `OwnerApi`, named `OwnerApi_<Name>_<operation>`:

| Tool | Does |
|---|---|
| `OwnerApi_SetHourlyRate_send` ... `OwnerApi_CancelPayment_send` | The ten commands |
| `OwnerApi_SitterDirectory_get`, `OwnerApi_HourlyRates_get`, `OwnerApi_SitterBalance_get`, `OwnerApi_Payouts_get` | Read a view's current state |
| `OwnerApi_SitterStatement_list` | Read a sitter's statement lines |

Each tool's description is the `description` annotation of its command or view, so the rules Claude follows ("Target: always \"home\"", "the date of the most recent Friday") come from `packages/domain/src/Babysitting/`. The server's instructions are the `OwnerApi`'s description: units, ids, and where to look things up.

## 1. Set the household rate

> Our babysitting rate is €15 an hour, since 1 January.

Claude converts euros to cents and calls:

```json
// OwnerApi_SetHourlyRate_send
{ "target": "home", "input": { "centsPerHour": 1500, "effectiveFrom": "2026-01-01" } }
```

Result:

```json
{
  "reply": { "centsPerHour": 1500, "effectiveFrom": "2026-01-01" },
  "stream": "RateCard/home",
  "version": 1
}
```

Every command answers with a receipt: the command's `reply`, the `stream` it wrote to (the aggregate and its id) and that stream's `version` after the write. The reply echoes what was recorded, so Claude can confirm "€15/h from 1 January" from the result rather than from what it meant to send.

## 2. Register Maria

> Maria babysits for us now. Her IBAN is FR76 3000 6000 0112 3456 7890 189.

Claude may first read the directory to check Maria isn't already there. On a new stage, no sitter has been registered yet, so the view has no state:

```json
// OwnerApi_SitterDirectory_get
{ "key": "home" }
```

```json
{ "value": null }
```

A view key that no event has reached reads as `null`: Alchemy Domain has no way to give it an empty state. So the descriptions of the three household views say what `null` means: no sitters yet for `SitterDirectory`, nothing to wire for `Payouts`, no household rate yet for `HourlyRates`, so Claude can tell an empty household from an error.

Then it registers her, with a slug of her name as the id:

```json
// OwnerApi_RegisterSitter_send
{ "target": "maria", "input": { "name": "Maria", "iban": "FR76 3000 6000 0112 3456 7890 189" } }
```

```json
{
  "reply": { "name": "Maria", "aliases": [], "iban": "FR7630006000011234567890189" },
  "stream": "Sitter/maria",
  "version": 1
}
```

The reply echoes what was recorded: the name, no nicknames, and the IBAN as stored, without spaces. The sitter's id is in `stream`: `Sitter/maria`.

Registering her also starts the `HourlyRateOnboarding` policy: a moment later, it copies the household rate into Maria's own rates (see [The babysitting model](/building/babysitting-model/#aggregates-one-per-sitter-and-the-rate-card)). That copy is `version` 2 of her stream.

## 3. "Maria 4h on Friday"

> Maria 4h on Friday

Claude turns "Maria" into a sitter id with the directory:

```json
// OwnerApi_SitterDirectory_get
{ "key": "home" }
```

```json
{
  "value": {
    "sitters": {
      "maria": {
        "name": "Maria",
        "aliases": [],
        "iban": "FR7630006000011234567890189",
        "active": true
      }
    },
    "sharedNames": []
  }
}
```

One sitter goes by Maria, and `sharedNames` is empty, so there is nothing to ask.

`LogShift`'s description asks for "the date of the most recent Friday (today or earlier, YYYY-MM-DD, Europe/Paris)". Today is Sunday 15 November, so Friday is `2026-11-13`, and 4 hours is `240` minutes:

```json
// OwnerApi_LogShift_send
{ "target": "maria", "input": { "date": "2026-11-13", "minutes": 240 } }
```

```json
{
  "reply": {
    "shiftId": "2026-11-13",
    "date": "2026-11-13",
    "minutes": 240,
    "centsPerHour": 1500,
    "amount": 6000,
    "balance": 6000,
    "otherShiftsThatDay": 0
  },
  "stream": "Sitter/maria",
  "version": 3
}
```

The shift was priced at Maria's rate on the 13th, €15/h, so it comes to €60, and her balance is €60. `otherShiftsThatDay: 0` tells Claude this isn't a second shift that day, so there is no duplicate to ask about. `version: 3` is the registration, the copied rate, then this shift.

**If it says `NoRateForDate`.** When `LogShift` arrives before the onboarding policy has copied the rate to a sitter who just registered, Maria has no rate for that day yet and the command is refused:

```json
{ "_tag": "NoRateForDate", "date": "2026-11-13" }
```

(Recorded by logging a shift for a sitter registered before any household rate existed. The local dev server applied the policy before the next call every time we tried, so the race itself didn't show there.) The policy catches up within a moment, so sending the same `LogShift` again works. If it keeps failing, the household has no rate for that date: `HourlyRates` and `SitterBalance` show which rates exist. This is the trade-off of copying the rate through policies; see [Decisions](/decisions/).

## 4. "What do I need to wire to whom?"

> What do I need to wire to whom?

```json
// OwnerApi_Payouts_get
{ "key": "home" }
```

```json
{
  "value": {
    "payouts": [
      {
        "sitterId": "maria",
        "name": "Maria",
        "iban": "FR7630006000011234567890189",
        "amount": 6000,
        "reference": "Babysitting 2026-11-13"
      }
    ],
    "total": 6000,
    "accounts": {
      "maria": {
        "name": "Maria",
        "iban": "FR7630006000011234567890189",
        "balance": 6000,
        "unpaidFrom": "2026-11-13",
        "unpaidTo": "2026-11-13"
      }
    }
  }
}
```

Claude lists each line of `payouts`, here €60 to Maria with her IBAN and the transfer reference to copy, and the total. The `Payouts` description also tells it that each transfer is recorded with `RecordPayment` afterwards.

Views update a moment after a command replies. Claude can wait for its own write by passing the receipt it got as `atLeast`, for example `{ "key": "home", "atLeast": { "stream": "Sitter/maria", "version": 3 } }`. The read then waits until the view has applied that version, up to 10 seconds.

## 5. "I paid Maria"

> I paid Maria

`RecordPayment` pays the whole balance, dated today, when `amount` and `date` are left out:

```json
// OwnerApi_RecordPayment_send
{ "target": "maria", "input": {} }
```

```json
{
  "reply": { "paymentId": "paid-2026-11-15", "amount": 6000, "balance": 0 },
  "stream": "Sitter/maria",
  "version": 4
}
```

€60 recorded, nothing left owed. Asked again, `Payouts` has nothing to wire:

```json
{
  "value": {
    "payouts": [],
    "total": 0,
    "accounts": {
      "maria": {
        "name": "Maria",
        "iban": "FR7630006000011234567890189",
        "balance": 0,
        "unpaidFrom": null,
        "unpaidTo": null
      }
    }
  }
}
```

## When Family OS says no

A rejection comes back as a tool error: the MCP result has `isError: true`, and its text is the rejection as JSON. Had Claude read "Friday" as next Friday:

```json
// OwnerApi_LogShift_send
{ "target": "maria", "input": { "date": "2026-11-20", "minutes": 240 } }
```

```json
{
  "content": [
    { "type": "text", "text": "{\"_tag\":\"DateInFuture\",\"date\":\"2026-11-20\",\"today\":\"2026-11-15\"}" }
  ],
  "isError": true
}
```

Nothing is recorded. The rejection names the date it got and today's date in Paris, which is what Claude needs to correct the date or ask. A wrong or missing token gives `{"_tag":"Unauthorized"}` the same way, on every tool.

For comparison, a successful result carries the receipt twice: as text in `content`, and as `structuredContent`, which matches the tool's output schema:

```json
{
  "content": [{ "type": "text", "text": "{\"reply\":{\"paymentId\":\"paid-2026-11-15\",...}" }],
  "structuredContent": {
    "reply": { "paymentId": "paid-2026-11-15", "amount": 6000, "balance": 0 },
    "stream": "Sitter/maria",
    "version": 4
  },
  "isError": false
}
```

## The same from a terminal

`fos` and `/api` publish the same calls. Set `FAMILY_OS_URL` and `FAMILY_OS_TOKEN` for the stage, for dev `https://family-os-dev.jrmdayn.workers.dev` and the owner token. Unset, `fos` uses `pnpm dev`'s `http://localhost:8787` and `dev-token`.

```sh
pnpm fos set-hourly-rate --target home --cents-per-hour 1500 --effective-from 2026-01-01
pnpm fos register-sitter --target maria --name Maria --iban "FR76 3000 6000 0112 3456 7890 189"
pnpm fos log-shift --target maria --date 2026-11-13 --minutes 240
pnpm fos payouts get --key home
pnpm fos record-payment --target maria
```

`fos` prints the same receipts and view states as above. Over plain HTTP, a command is a `POST` and a view a `GET`:

```sh
curl -X POST "$FAMILY_OS_URL/api/LogShift" \
  -H "authorization: Bearer $FAMILY_OS_TOKEN" -H 'content-type: application/json' \
  -d '{"target":"maria","input":{"date":"2026-11-13","minutes":240}}'
curl "$FAMILY_OS_URL/api/Payouts/home" -H "authorization: Bearer $FAMILY_OS_TOKEN"
```

A view read over `/api` returns the state itself, without the `value` wrapper MCP adds. A rejection is a `422` with the same JSON, for example `{"_tag":"DateInFuture","date":"2026-11-20","today":"2026-11-15"}`.

## Call a tool without Claude

To see exactly what Claude gets, send the MCP request yourself. `/mcp` speaks MCP `2026-07-28`, which needs no session: every request carries its protocol version, in a header and in `_meta`.

```sh
curl -X POST "$FAMILY_OS_URL/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -H 'mcp-protocol-version: 2026-07-28' \
  -H 'mcp-method: tools/call' \
  -H 'mcp-name: OwnerApi_LogShift_send' \
  -H "authorization: Bearer $FAMILY_OS_TOKEN" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "tools/call",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { "name": "curl", "version": "1" },
        "io.modelcontextprotocol/clientCapabilities": {}
      },
      "name": "OwnerApi_LogShift_send",
      "arguments": { "target": "maria", "input": { "date": "2026-11-13", "minutes": 240 } }
    }
  }'
```

For the tool list, send `"method": "tools/list"` with `mcp-method: tools/list`, no `mcp-name`, and `params` holding only `_meta`.

## Locally

Everything above works against `pnpm dev`, with the model in memory and `dev-token` as the token:

```sh
pnpm dev
claude mcp add --transport http family-os-local http://localhost:8787/mcp \
  --header "Authorization: Bearer dev-token"
```

The local server starts empty every time, so begin with step 1. See [Local development](/building/local-development/).
