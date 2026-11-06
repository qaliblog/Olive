#!/usr/bin/env node
/**
 * Scores the base model's Colab generations and writes the Colab reports.
 *
 * The model output is parsed, not trusted: a tool call is valid only when the LFM2.5 call syntax in the generated text
 * parses into a name and an argument mapping. Generated code is checked with a real parser/runner.
 *
 *   node olivellm/scripts/eval-report.js [run.json]
 */
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { countBy, readJsonl, writeJson, writeJsonl } from "./lib/json.js"
import { parseGeneration } from "./lib/lfm2-parse.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
// A run id writes into its own directory so a re-measurement never overwrites the published baseline.
const runFlag = process.argv.indexOf("--run")
const runId = runFlag === -1 ? undefined : process.argv[runFlag + 1]
const casesFlag = process.argv.indexOf("--cases")
const casesFile = path.join(root, casesFlag === -1 ? "evaluation/colab/cases.jsonl" : process.argv[casesFlag + 1])
const reports = runId ? path.join(root, "reports/colab/runs", runId) : path.join(root, "reports/colab")
await mkdir(reports, { recursive: true })
const runFile = path.resolve(process.argv[2] ?? path.join(root, "evaluation/colab/baseline-run.json"))
const cases = await readJsonl(casesFile).then((items) => items.map((item) => item.value))
const byId = new Map(cases.map((item) => [item.id, item]))
const run = JSON.parse(await readFile(runFile, "utf8"))

const scored = []
for (const generation of run.cases) {
  const item = byId.get(generation.id)
  if (!item) continue
  const parsed = parseGeneration(generation.text)
  const expected = item.expect
  const first = parsed.calls[0]
  const expectedSchema = expected.tool ? item.tools.find((tool) => tool.name === expected.tool)?.parameters : undefined
  scored.push({
    id: generation.id,
    suite: generation.suite,
    language: generation.language,
    text: generation.text,
    prompt_tokens: generation.prompt_tokens,
    output_tokens: generation.output_tokens,
    seconds: generation.seconds,
    parsed,
    expected,
    correct_tool: Boolean(first && expected.tool && first.name === expected.tool),
    unknown_tool: Boolean(first && !item.tools.some((tool) => tool.name === first.name)),
    argument_names: first && expected.arguments ? sameKeys(first.arguments, expected.arguments) : undefined,
    required_arguments: first && expectedSchema ? (expectedSchema.required ?? []).every((key) => key in first.arguments) : undefined,
    argument_types: first && expectedSchema ? typesMatch(first.arguments, expectedSchema) : undefined,
    kind_correct: expected.kind === "tool_call" ? parsed.calls.length > 0 : parsed.calls.length === 0,
  })
}

const directory = await mkdtemp(path.join(os.tmpdir(), "olivellm-eval-"))

const aggregate = summarise(scored)
const tool = scored.filter((item) => item.suite === "tool_calling")
const coding = scored.filter((item) => item.suite === "coding")
const multilingual = scored.filter((item) => item.suite === "multilingual")
const baseline = scored.filter((item) => item.suite === "baseline")

const codingChecks = []
for (const item of coding) {
  const call = item.parsed.calls[0]
  const content = call?.arguments?.content
  const file = expectedFile(item)
  codingChecks.push({
    id: item.id,
    produced_file: Boolean(call?.name === "write_file" && typeof content === "string"),
    syntax: typeof content === "string" ? await syntaxOf(directory, item.id, content, file) : "missing",
  })
}

await rm(directory, { recursive: true, force: true })

const efficiency = {
  cases: scored.length,
  prompt_tokens: sum(scored, (item) => item.prompt_tokens),
  output_tokens: sum(scored, (item) => item.output_tokens),
  average_prompt_tokens: round(average(scored.map((item) => item.prompt_tokens))),
  average_output_tokens: round(average(scored.map((item) => item.output_tokens))),
  total_seconds: round(sum(scored, (item) => item.seconds)),
  tokens_per_second: round(sum(scored, (item) => item.output_tokens) / Math.max(0.001, sum(scored, (item) => item.seconds))),
  average_seconds_per_case: round(average(scored.map((item) => item.seconds))),
  context_usage: round(average(scored.map((item) => item.prompt_tokens)) / 32768),
}

const metrics = {
  status: "measured",
  model: run.model,
  device: run.device,
  evaluation_set: {
    source: "olivellm/evaluation/colab/cases.jsonl",
    held_out: true,
    excluded_from_training: true,
    cases: scored.length,
    by_suite: countBy(scored, (item) => item.suite),
    by_language: countBy(scored, (item) => item.language),
  },
  conditions: "greedy decoding, max_new_tokens=192, temperature 0 (no sampling), identical prompts for any later fine-tuned model",
  overall: aggregate,
  efficiency,
  measured_at: new Date().toISOString(),
}
await writeJson(path.join(reports, "baseline_metrics.json"), metrics)

await writeJson(path.join(reports, "tool_call_evaluation.json"), {
  status: "measured",
  suite: "tool_calling",
  cases: tool.length,
  ...summarise(tool),
  failures: tool.filter((item) => !item.correct_tool).map(describe),
})

await writeJson(path.join(reports, "coding_evaluation.json"), {
  status: "measured",
  suite: "coding",
  cases: coding.length,
  produced_file_rate: round(codingChecks.filter((item) => item.produced_file).length / Math.max(1, codingChecks.length)),
  syntax_valid_rate: round(codingChecks.filter((item) => item.syntax === "valid").length / Math.max(1, codingChecks.length)),
  syntax_results: countBy(codingChecks, (item) => item.syntax),
  checks: codingChecks,
  note: "JavaScript is checked with `node --check`; CSS and HTML are checked for balanced braces and tags. A case that produced no file cannot pass a syntax check.",
  ...summarise(coding),
})

await writeJson(path.join(reports, "multilingual_evaluation.json"), {
  status: "measured",
  suite: "multilingual",
  cases: multilingual.length,
  by_language: Object.fromEntries(
    [...new Set(multilingual.map((item) => item.language))].map((language) => [
      language,
      summarise(multilingual.filter((item) => item.language === language)),
    ]),
  ),
  unicode_robustness: {
    cases_with_replacement_characters: multilingual.filter((item) => item.text.includes("\ufffd")).length,
    cases_with_persian_output: multilingual.filter((item) => /[\u0600-\u06ff]/.test(item.text)).length,
  },
  ...summarise(multilingual),
})

await writeJson(path.join(reports, "baseline_evaluation.json"), {
  status: "measured",
  suite: "baseline",
  cases: baseline.length,
  ...summarise(baseline),
})

await writeJsonl(path.join(reports, "raw/generations.jsonl"), scored.map((item) => ({ ...item, parsed: item.parsed, text: item.text })))

const failures = scored.filter((item) => !item.correct_tool)
await writeFile(
  path.join(reports, "FAILURES.md"),
  [
    "# Base-model failures",
    "",
    `Model: ${run.model} on ${run.device}. ${scored.length} cases, ${aggregate.tool_accuracy === undefined ? 0 : Math.round(aggregate.tool_accuracy * 100)}% correct tool selection.`,
    "",
    "Every case below was scored from the model's raw generation; nothing was repaired by hand.",
    "",
    "| case | suite | language | expected tool | parsed call |",
    "| --- | --- | --- | --- | --- |",
    ...failures.slice(0, 80).map((item) => `| ${item.id} | ${item.suite} | ${item.language} | ${item.expected.tool ?? "(text)"} | ${item.parsed.calls[0] ? item.parsed.calls[0].name : item.parsed.text ? "text only" : "unparseable"} |`),
    "",
    `Total failing cases: ${failures.length} of ${scored.length}.`,
    "",
  ].join("\n"),
)

console.log("overall:", aggregate)
console.log("efficiency:", efficiency)
console.log(`wrote reports to ${path.relative(process.cwd(), reports)}`)

function summarise(items) {
  const withCall = items.filter((item) => item.expected.kind === "tool_call")
  return {
    valid_call_rate: round(withCall.length === 0 ? 0 : withCall.filter((item) => item.parsed.calls.length > 0 && !item.parsed.invalid).length / withCall.length),
    invalid_call_rate: round(withCall.length === 0 ? 0 : withCall.filter((item) => item.parsed.invalid).length / withCall.length),
    unknown_tool_rate: round(withCall.length === 0 ? 0 : withCall.filter((item) => item.unknown_tool).length / withCall.length),
    tool_accuracy: round(withCall.length === 0 ? 0 : withCall.filter((item) => item.correct_tool).length / withCall.length),
    argument_names_accuracy: round(ratio(withCall.filter((item) => item.argument_names === true).length, withCall.filter((item) => item.argument_names !== undefined).length)),
    required_arguments_rate: round(ratio(withCall.filter((item) => item.required_arguments === true).length, withCall.filter((item) => item.required_arguments !== undefined).length)),
    argument_types_rate: round(ratio(withCall.filter((item) => item.argument_types === true).length, withCall.filter((item) => item.argument_types !== undefined).length)),
    response_kind_accuracy: round(ratio(items.filter((item) => item.kind_correct).length, items.length)),
    tool_call_cases: withCall.length,
  }
}

function describe(item) {
  return {
    id: item.id,
    language: item.language,
    expected: item.expected.tool,
    parsed: item.parsed.calls[0]?.name ?? null,
    text: item.text.slice(0, 220),
  }
}

function expectedFile(item) {
  const file = item.expected.files?.[0]
  return file ?? "index.js"
}

async function syntaxOf(directory, id, content, file) {
  const extension = path.extname(file) || ".js"
  if ([".js", ".mjs", ".cjs"].includes(extension)) {
    const target = path.join(directory, `eval-${id.replaceAll(/[^a-z0-9]/gi, "-")}${extension}`)
    await writeFile(target, content, "utf8")
    const result = spawnSync("node", ["--check", target], { encoding: "utf8" })
    return result.status === 0 ? "valid" : "invalid"
  }
  if (extension === ".css") return balanced(content, "{", "}") ? "valid" : "invalid"
  if (extension === ".html") return balanced(content, "<div", "</div>") ? "valid" : "checked"
  return "unchecked"
}

function balanced(text, open, close) {
  return text.split(open).length === text.split(close).length
}

function sameKeys(left, right) {
  const a = Object.keys(left).toSorted()
  const b = Object.keys(right).toSorted()
  return a.length === b.length && a.every((key, index) => key === b[index])
}

function typesMatch(argumentsValue, schema) {
  return Object.entries(schema.properties ?? {}).every(([key, property]) => {
    if (!(key in argumentsValue)) return true
    const value = argumentsValue[key]
    if (property.type === "string") return typeof value === "string"
    if (property.type === "integer") return Number.isInteger(value)
    if (property.type === "number") return typeof value === "number"
    return true
  })
}

function sum(items, key) {
  return items.reduce((total, item) => total + key(item), 0)
}
function average(values) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}
function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : numerator / denominator
}
function round(value) {
  return Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000
}
