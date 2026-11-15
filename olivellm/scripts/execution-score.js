#!/usr/bin/env bun
/**
 * Measures execution success for a generation run: every parsed tool call is handed to the real
 * `OliveTools.execute`, so the number is what the executor did, not what the model claimed.
 *
 * The workspace is seeded from what the exported record actually carries: `context.code` supplies file contents and
 * `context.workspace` supplies the remaining paths as empty files and directories. Nothing is generated to make a call
 * succeed.
 *
 * A held-out record does not always carry the file contents a call needs, so a correct call can still fail against the
 * seeded workspace. Each case is therefore gated on its own reference call: the expected tool and arguments from the
 * record are executed first, in a fresh workspace. A case whose reference call does not execute is reported as
 * `not-executable` and kept out of the success denominator — otherwise a fine-tuned model that emits the correct call
 * would be scored against a fixture that cannot satisfy it. The two sides are then measured on exactly the same cases.
 *
 *   bun olivellm/scripts/execution-score.js <run.json> --cases evaluation/colab/cases.jsonl --run <run-id>
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveTools } from "../../packages/core/src/olive/tools.ts"
import { countBy, readJsonl, writeJson } from "./lib/json.js"
import { parseGeneration } from "./lib/lfm2-parse.js"

const REJECTIONS = ["invalid-arguments", "outside-workspace", "ambiguous-match"]

const root = path.resolve(import.meta.dir, "..")
const flag = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : process.argv[index + 1]
}

const runFile = path.resolve(process.argv[2] ?? "")
const casesFile = path.resolve(root, flag("--cases", "evaluation/colab/cases.jsonl"))
const runId = flag("--run", undefined)
const reports = runId ? path.join(root, "reports/colab/runs", runId) : path.join(root, "reports/colab")

const cases = await readJsonl(casesFile).then((items) => items.map((item) => item.value))
const heldout = await readJsonl(path.join(root, "datasets/processed/heldout.jsonl")).then(
  (items) => new Map(items.map((item) => [item.value.id, item.value])),
)
const run = await Bun.file(runFile).json()
const generations = new Map(run.cases.map((item) => [item.id, item]))

const results = []
for (const [id, item] of new Map(cases.map((item) => [item.id, item]))) {
  const generation = generations.get(id)
  if (!generation) continue
  const record = heldout.get(id)
  const reference = item.expect.tool
    ? await execute(item.expect.tool, item.expect.arguments ?? {}, record)
    : { status: "ok", error: null }
  const call = parseGeneration(generation.text).calls[0]
  const executed = call ? await execute(call.name, call.arguments, record) : { status: "no-call", error: null }
  results.push({
    id,
    suite: item.suite,
    language: item.language,
    expected_tool: item.expect.tool ?? null,
    tool: call?.name ?? null,
    arguments: call?.arguments ?? null,
    reference: reference.status,
    ...executed,
    status: reference.status === "failed" ? "not-executable" : executed.status,
  })
}

const scored = results.filter((item) => item.status !== "not-executable")
const toolCall = scored.filter((item) => item.expected_tool !== null)
const executedOk = toolCall.filter((item) => item.status === "ok").length
const emitted = toolCall.filter((item) => item.tool !== null).length

await mkdir(reports, { recursive: true })
await writeJson(path.join(reports, "execution_evaluation.json"), {
  status: "measured",
  run_id: runId ?? null,
  adapter: run.adapter ?? null,
  model: run.model,
  definition:
    "The parsed call is executed by the real OliveTools.execute in a workspace seeded from the record's context.code and context.workspace. A case is gated on its own reference call: when the expected call cannot execute in that workspace the case is `not-executable` and excluded, so both models are scored on the same executable cases. `ok` means the executor returned success; a failure carries the executor's error code.",
  cases: results.length,
  executable_cases: scored.length,
  not_executable_cases: results.filter((item) => item.status === "not-executable").length,
  tool_call_cases: results.filter((item) => item.expected_tool !== null).length,
  scored_tool_call_cases: toolCall.length,
  calls_emitted: emitted,
  executed: executedOk,
  execution_success_rate_of_tool_call_cases: ratio(executedOk, toolCall.length),
  execution_success_rate_of_emitted_calls: ratio(executedOk, emitted),
  rejections: toolCall.filter((item) => REJECTIONS.includes(item.error)).length,
  statuses: countBy(results, (item) => item.status),
  error_codes: countBy(
    toolCall.filter((item) => item.error),
    (item) => item.error,
  ),
  by_language: Object.fromEntries(
    [...new Set(results.map((item) => item.language))].map((language) => {
      const items = results.filter((item) => item.language === language)
      const usable = items.filter((item) => item.status !== "not-executable" && item.expected_tool !== null)
      return [
        language,
        {
          cases: items.length,
          executable_tool_call_cases: usable.length,
          calls_emitted: usable.filter((item) => item.tool !== null).length,
          executed: usable.filter((item) => item.status === "ok").length,
          execution_success_rate: ratio(
            usable.filter((item) => item.status === "ok").length,
            usable.length,
          ),
          not_executable: items.filter((item) => item.status === "not-executable").length,
        },
      ]
    }),
  ),
  by_tool: countBy(scored.filter((item) => item.tool !== null), (item) => item.tool),
  failures: scored.filter((item) => item.status !== "ok" && item.tool !== null),
})

console.log(
  `execution: ${executedOk}/${toolCall.length} executable tool-call cases (${emitted} calls emitted, ` +
    `${results.filter((item) => item.status === "not-executable").length} cases excluded as not executable)`,
)
console.log("statuses:", countBy(results, (item) => item.status))

async function execute(name, input, record) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "olive-exec-"))
  try {
    await seed(directory, record)
    const result = await OliveTools.execute(name, input, { directory, signal: AbortSignal.timeout(15_000) }).catch(
      () => ({ ok: false, error: { code: "exception" } }),
    )
    return result.ok ? { status: "ok", error: null } : { status: "failed", error: result.error.code }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function seed(directory, record) {
  const written = new Set((record?.context?.code ?? []).map((item) => item.file))
  for (const entry of record?.context?.workspace ?? []) {
    if (entry === "." || entry.endsWith("/")) {
      await mkdir(path.join(directory, entry), { recursive: true })
      continue
    }
    await mkdir(path.dirname(path.join(directory, entry)), { recursive: true })
    if (!written.has(entry)) await writeFile(path.join(directory, entry), "", "utf8")
  }
  for (const item of record?.context?.code ?? []) {
    const target = path.join(directory, item.file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, item.text, "utf8")
  }
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 1000
}
