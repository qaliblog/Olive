#!/usr/bin/env node
/**
 * Builds the chat-template parity fixtures and compares them with the real Hugging Face tokenizer output.
 *
 *   node olivellm/scripts/tokenizer-parity.js emit
 *   node olivellm/scripts/tokenizer-parity.js compare evaluation/tokenizer/hf-outputs.json
 *
 * Parity is byte-for-byte: a single differing character is a failure, and the exact mismatch is recorded.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readJson, writeJson } from "./lib/json.js"
import { FIXTURES } from "./lib/lfm2-fixtures.js"
import { render } from "./lib/lfm2.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const directory = path.join(root, "evaluation/tokenizer")
const reports = path.join(root, "reports/colab")
const mode = process.argv[2] ?? "emit"

if (mode === "emit") {
  await writeJson(
    path.join(directory, "fixtures.json"),
    FIXTURES.map((fixture) => ({
      id: fixture.id,
      messages: fixture.messages,
      tools: fixture.tools,
      ...(fixture.addGenerationPrompt ? { addGenerationPrompt: true } : {}),
    })),
  )
  await writeJson(path.join(directory, "js-outputs.json"), {
    renderer: "olivellm/scripts/lib/lfm2.js",
    outputs: FIXTURES.map((fixture) => {
      try {
        return { id: fixture.id, output: render(fixture) }
      } catch (error) {
        return { id: fixture.id, error: `${error.name}: ${error.message}` }
      }
    }),
  })
  console.log(`wrote ${FIXTURES.length} fixtures and their JavaScript renderings`)
} else if (mode === "compare") {
  const file = path.resolve(process.argv[3] ?? path.join(directory, "hf-outputs.json"))
  const hf = await readJson(file)
  const js = await readJson(path.join(directory, "js-outputs.json"))
  const jsById = new Map(js.outputs.map((entry) => [entry.id, entry]))
  const cases = hf.results.map((entry) => {
    const javascript = jsById.get(entry.id) ?? {}
    if (entry.error) return { id: entry.id, matched: false, hf_error: entry.error }
    if (javascript.error) return { id: entry.id, matched: false, js_error: javascript.error }
    const matched = entry.output === javascript.output
    return {
      id: entry.id,
      matched,
      ...(matched ? {} : { ...firstDifference(javascript.output, entry.output) }),
    }
  })
  const matched = cases.filter((entry) => entry.matched).length
  const parity = {
    status: matched === cases.length ? "verified" : "failed",
    model: hf.model,
    tokenizer_class: hf.tokenizer_class,
    comparison: "byte-for-byte against tokenizer.apply_chat_template(messages, tools, tokenize=False)",
    cases: cases.length,
    matched,
    mismatched: cases.length - matched,
    results: cases,
  }
  await writeJson(path.join(reports, "tokenizer_parity.json"), parity)
  await writeJson(path.join(reports, "tokenizer_mismatches.json"), {
    model: hf.model,
    cases: cases.filter((entry) => !entry.matched),
  })
  console.log(`${matched}/${cases.length} fixtures match byte for byte`)
  for (const entry of cases.filter((item) => !item.matched)) console.log("mismatch:", entry.id, entry.js_error ?? entry.hf_error ?? `at ${entry.index}`)
  if (matched !== cases.length) process.exitCode = 1
}

/** Position and context of the first divergence, which is what a template fix needs. */
function firstDifference(javascript, huggingface) {
  const length = Math.max(javascript.length, huggingface.length)
  let index = 0
  while (index < length && javascript[index] === huggingface[index]) index += 1
  return {
    index,
    javascript: javascript.slice(Math.max(0, index - 40), index + 60),
    huggingface: huggingface.slice(Math.max(0, index - 40), index + 60),
    javascript_length: javascript.length,
    huggingface_length: huggingface.length,
  }
}
