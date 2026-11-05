#!/usr/bin/env node
/**
 * Builds the frozen evaluation input set for the Colab harness.
 *
 * The held-out suite stays separate from training and validation. Each suite is capped at a fixed number of cases
 * (deterministic: ids are sorted, then an even stride is taken) so a baseline run finishes on one Colab session.
 *
 *   node olivellm/scripts/eval-cases.js [--limit 24]
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { countBy, readJsonl, sha1, writeJson, writeJsonl } from "./lib/json.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const evaluation = path.join(root, "evaluation")
const output = path.join(evaluation, "colab/cases.json")
const limit = Number(process.argv[process.argv.indexOf("--limit") + 1] ?? 24) || 24
const file = process.argv.includes("--limit") ? 24 : limit

const suites = ["tool_calling", "coding", "multilingual", "baseline"]
const cases = []

for (const suite of suites) {
  const rows = await readJsonl(path.join(evaluation, suite, "cases.jsonl")).then((items) => items.map((item) => item.value))
  const sorted = rows.toSorted((left, right) => left.id.localeCompare(right.id))
  const stride = Math.max(1, Math.floor(sorted.length / Math.min(file, Math.max(1, sorted.length))))
  const picked = sorted.filter((_, index) => index % stride === 0).slice(0, file)
  for (const row of picked)
    cases.push({
      id: row.id,
      suite,
      language: row.language,
      category: row.category,
      messages: row.messages,
      tools: row.tools,
      expect: row.expect,
      reference: row.reference,
    })
}

const heldout = await readFile(path.join(evaluation, "heldout/ids.json"), "utf8")

await writeJsonl(path.join(evaluation, "colab/cases.jsonl"), cases)

await writeJson(output, {
  version: "1.0.0",
  model: "LiquidAI/LFM2.5-350M",
  limit_per_suite: file,
  heldout_ids_sha1: sha1(heldout),
  suites: countBy(cases, (item) => item.suite),
  languages: countBy(cases, (item) => item.language),
  cases,
})
console.log(`wrote ${cases.length} evaluation cases`, countBy(cases, (item) => item.suite))
