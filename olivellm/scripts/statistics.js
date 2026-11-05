#!/usr/bin/env node
/**
 * Measures the dataset and reports the distance to the Phase 10 targets. Targets are coverage goals, not quotas;
 * every shortfall is reported instead of being padded with filler examples.
 *
 *   node olivellm/scripts/statistics.js
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EPOCH } from "./lib/emit.js"
import { countBy, estimateTokens, readJsonl, writeJson } from "./lib/json.js"
import { buildStep, SYSTEM } from "./lib/prompt.js"
import { initialize } from "./lib/state.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")

const COVERAGE = [
  { goal: "intent and requirement", target: 200, categories: ["intent_understanding", "requirement_extraction"] },
  { goal: "planning", target: 200, categories: ["task_planning"] },
  { goal: "tool selection", target: 300, categories: ["project_structure", "file_reading"] },
  { goal: "tool execution", target: 300, categories: ["file_creation", "file_editing", "dependency_installation", "diagnostics", "test_execution"] },
  { goal: "task state", target: 300, categories: ["task_state_update", "task_resumption"] },
  { goal: "coding", target: 300, categories: ["file_creation", "file_editing", "code_generation"] },
  { goal: "debugging", target: 200, categories: ["error_recovery"] },
  { goal: "verification", target: 100, categories: ["completion_verification", "test_execution"] },
  { goal: "persian", target: 100, languages: ["fa"] },
]

const rows = await readJsonl(path.join(root, "datasets/validated/deduplicated.jsonl")).then((items) => items.map((item) => item.value))
const splits = {}
for (const split of ["train", "validation", "test", "heldout"]) {
  splits[split] = await readJsonl(path.join(root, "datasets/processed", `${split}.jsonl`)).then((items) => items.map((item) => item.value))
}
const rejected = await readJsonl(path.join(root, "datasets/rejected/rejected.jsonl")).then((items) => items.map((item) => item.value))
const duplicates = await readJsonl(path.join(root, "datasets/rejected/rejected-duplicates.jsonl")).then((items) => items.map((item) => item.value))

const tokens = rows.map((row) => promptTokens(row) + estimateTokens(row.expected_response.text))
const coverage = COVERAGE.map((entry) => {
  const count = entry.languages
    ? rows.filter((row) => entry.languages.includes(row.language)).length
    : rows.filter((row) => entry.categories.includes(row.category)).length
  return { ...entry, count, shortfall: Math.max(0, entry.target - count) }
})

const statistics = {
  version: "1.0.0",
  records: {
    generated: rejected.length + rows.length + duplicates.length,
    validated: rows.length,
    rejected: rejected.length,
    duplicates_removed: duplicates.length,
    rejection_rate: round((rejected.length + duplicates.length) / Math.max(1, rejected.length + rows.length + duplicates.length)),
  },
  splits: Object.fromEntries(Object.entries(splits).map(([name, items]) => [name, items.length])),
  categories: countBy(rows, (row) => row.category),
  languages: countBy(rows, (row) => row.language),
  difficulties: countBy(rows, (row) => row.difficulty),
  completions: countBy(rows, (row) => row.expected_response.completion),
  kinds: countBy(rows, (row) => row.expected_response.kind),
  tools: countBy(
    rows.flatMap((row) => row.expected_tool_calls),
    (call) => call.name,
  ),
  failures: countBy(
    rows.flatMap((row) => row.expected_tool_results.filter((result) => !result.ok)),
    (result) => result.error_code,
  ),
  tokens: {
    estimated_total: tokens.reduce((total, value) => total + value, 0),
    average: round(average(tokens)),
    median: median(tokens),
    p95: percentile(tokens, 0.95),
    max: Math.max(...tokens),
  },
  coverage,
  shortfalls: coverage.filter((entry) => entry.shortfall > 0).map((entry) => `${entry.goal}: ${entry.count}/${entry.target}`),
  rejection_reasons: countBy(rejected.flatMap((item) => item.reasons.map((reason) => reason.replace(/\(same as .*\)/, "").trim())), (reason) => reason),
  duplicate_reasons: countBy(duplicates.flatMap((item) => item.reasons.map((reason) => reason.replace(/\(.*\)/, "").trim())), (reason) => reason),
}

await writeJson(path.join(root, "reports/statistics.json"), statistics)

console.log(`${rows.length} validated records, ${rejected.length} rejected, ${duplicates.length} duplicates removed`)
console.log("splits:", statistics.splits)
console.log("tokens (prompt + answer):", statistics.tokens)
console.log("categories:", statistics.categories)
console.log("languages:", statistics.languages)
for (const entry of coverage) console.log(`${entry.shortfall === 0 ? "ok  " : "gap "} ${entry.goal}: ${entry.count}/${entry.target}`)

function promptTokens(row) {
  const step = buildStep({
    task: row.context.task_state ?? initialize(row.objective, EPOCH + row.source.seed),
    code: row.context.code,
    toolResults: row.context.tool_results,
  })
  return estimateTokens([SYSTEM, ...row.context.conversation.map((message) => message.content), step].join("\n"))
}

function average(values) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}

function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].toSorted((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = [...values].toSorted((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
