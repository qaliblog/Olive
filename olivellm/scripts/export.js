#!/usr/bin/env node
/**
 * Exports the processed splits as LFM2.5 chat records, preference pairs and evaluation cases.
 *
 *   node olivellm/scripts/export.js
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EPOCH } from "./lib/emit.js"
import { countBy, estimateTokens, readJson, readJsonl, writeJson, writeJsonl } from "./lib/json.js"
import { assistantTarget, render } from "./lib/lfm2.js"
import { buildMessages } from "./lib/prompt.js"
import { initialize } from "./lib/state.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const processed = path.join(root, "datasets/processed")
const catalog = await readJson(path.join(root, "schemas/tool_call.schema.json"))

/** The tool list exactly as `renderTools` expects it. */
const tools = Object.entries(catalog.$defs).map(([name, definition]) => ({
  name,
  description: definition.description,
  parameters: definition.parameters,
}))

const splits = ["train", "validation", "test", "heldout"]
const exported = {}

for (const split of splits) {
  const rows = await readJsonl(path.join(processed, `${split}.jsonl`)).then((items) => items.map((item) => item.value))
  const records = rows.map((row) => toRecord(row, tools))
  await writeJsonl(path.join(processed, `sft-${split}.jsonl`), records)
  exported[split] = { examples: records.length, tokens: sum(records.map((record) => record.tokens)) }
}

const heldoutRows = await readJsonl(path.join(processed, "heldout.jsonl")).then((items) => items.map((item) => item.value))
await writeJsonl(path.join(root, "evaluation/heldout/cases.jsonl"), heldoutRows.map((row) => toCase(row, tools)))
await writeJsonl(
  path.join(root, "evaluation/tool_calling/cases.jsonl"),
  heldoutRows.filter((row) => row.expected_tool_calls.length > 0).map((row) => toCase(row, tools)),
)
await writeJsonl(
  path.join(root, "evaluation/coding/cases.jsonl"),
  heldoutRows.filter((row) => row.expected_tool_calls.some((call) => call.name === "write_file")).map((row) => toCase(row, tools)),
)
await writeJsonl(
  path.join(root, "evaluation/multilingual/cases.jsonl"),
  heldoutRows.filter((row) => row.language !== "en").map((row) => toCase(row, tools)),
)
await writeJsonl(
  path.join(root, "evaluation/baseline/cases.jsonl"),
  heldoutRows.filter((row, index) => index % 2 === 0).map((row) => toCase(row, tools)),
)

const preference = await readJsonl(path.join(root, "datasets/validated/deduplicated.jsonl")).then((items) =>
  items
    .map((item) => item.value)
    .filter((row) => row.category === "error_recovery" && row.language === "en")
    .map((row) => toPreference(row, tools)),
)
await writeJsonl(path.join(root, "datasets/preference/preferences.jsonl"), preference)

await writeJson(path.join(processed, "export-manifest.json"), {
  version: "1.0.0",
  renderer: "olivellm/scripts/lib/lfm2.js (LFM2.5 chat template, single-quoted tool arguments)",
  tools: tools.map((tool) => tool.name),
  splits: exported,
  preference_pairs: preference.length,
  heldout_cases: heldoutRows.length,
})

console.log("exported:", exported)
console.log(`preference pairs: ${preference.length}`)

function toRecord(row, toolList) {
  const messages = [...promptMessages(row), assistantMessage(row)]
  const text = render({ messages, tools: toolList })
  return {
    id: row.id,
    category: row.category,
    language: row.language,
    completion: row.expected_response.completion,
    messages,
    tools: toolList,
    text,
    target: assistantTarget(assistantMessage(row)),
    tokens: estimateTokens(text),
  }
}

function promptMessages(row) {
  return buildMessages({
    task: row.context.task_state ?? initialize(row.objective, EPOCH + row.source.seed),
    code: row.context.code,
    toolResults: row.context.tool_results,
    conversation: row.context.conversation.map((message) => ({
      ...message,
      toolCalls: message.toolCalls?.map((call) => ({
        name: call.name,
        arguments: typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments,
      })),
    })),
  })
}

function assistantMessage(row) {
  return {
    role: "assistant",
    content: row.expected_response.text,
    toolCalls: row.expected_tool_calls.map((call, index) => ({ id: `call_${index + 1}`, name: call.name, arguments: call.arguments })),
  }
}

function toCase(row, toolList) {
  return {
    id: row.id,
    category: row.category,
    language: row.language,
    messages: promptMessages(row),
    tools: toolList,
    expect: {
      kind: row.expected_response.kind,
      completion: row.expected_response.completion,
      tool: row.expected_tool_calls[0]?.name,
      arguments: row.expected_tool_calls[0]?.arguments,
      files: row.expected_tool_calls.filter((call) => call.name === "write_file").map((call) => call.arguments.path),
      files_created: row.expected_task_state.files.filter((file) => !row.context.task_state?.files.includes(file)),
    },
    reference: { text: row.expected_response.text, calls: row.expected_tool_calls },
  }
}

function toPreference(row, toolList) {
  const messages = promptMessages(row)
  return {
    id: `${row.id}.preference`,
    prompt: render({ messages, tools: toolList, addGenerationPrompt: true }),
    chosen: row.expected_response.text,
    rejected: [
      { text: "Sorry, that didn't work. Please try again.", reason: "apology with no cause, no file and no next action" },
      { text: "Done — everything works now.", reason: "claims success without a successful tool result" },
    ],
    category: row.category,
    language: row.language,
  }
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}
