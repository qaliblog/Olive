#!/usr/bin/env bun
/**
 * Builds the corrected-prompt variant of the frozen evaluation set.
 *
 * The frozen cases carry the step message as it was rendered before defect D11 was fixed: a task-state block with no
 * instruction. `evaluation/colab/cases.json` stays exactly as it was, because it is the record of the baseline those
 * cases produced. This script renders the same states with the runtime instruction appended and writes a separate
 * file, so the corrected run has its own id and nothing is overwritten.
 *
 * The frozen states carry no `next` action, so `instruction()` with no argument is byte-identical to what
 * `OlivePrompt.build` renders for the same state.
 *
 *   bun olivellm/scripts/instruction-cases.js
 */
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { countBy, sha1, writeJson, writeJsonl } from "./lib/json.js"
import { instruction } from "./lib/prompt.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const source = path.join(root, "evaluation/colab/cases.json")
const runId = process.argv[2] ?? "2026-11-06-instruction"

const text = await readFile(source, "utf8")
const payload = JSON.parse(text)
const cases = payload.cases.map((item) => ({
  ...item,
  messages: item.messages.map((message, index) =>
    index === item.messages.length - 1 && message.role === "user"
      ? { ...message, content: `${message.content}\n\n${instruction()}` }
      : message,
  ),
}))

const stem = path.join(root, `evaluation/colab/cases-${runId}`)
await writeJsonl(`${stem}.jsonl`, cases)
await writeJson(`${stem}.json`, {
  version: payload.version,
  run_id: runId,
  model: payload.model,
  source: "evaluation/colab/cases.json",
  source_sha1: sha1(text),
  change: "the runtime step instruction appended to the final user turn; every case, tool list and expectation is otherwise unchanged",
  limit_per_suite: payload.limit_per_suite,
  heldout_ids_sha1: payload.heldout_ids_sha1,
  suites: countBy(cases, (item) => item.suite),
  languages: countBy(cases, (item) => item.language),
  cases,
})
console.log(`wrote ${cases.length} corrected-prompt cases as ${runId}`, countBy(cases, (item) => item.suite))
