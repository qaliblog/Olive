#!/usr/bin/env node
/**
 * Generates the raw dataset. Deterministic: the same code and seed always write byte-identical JSONL.
 *
 *   node olivellm/scripts/generate.js
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { generateAll } from "./lib/generators.js"
import { countBy, writeJson, writeJsonl } from "./lib/json.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const file = path.join(root, "datasets/raw/examples.jsonl")

const { rows, counters } = generateAll()

const ids = new Set()
for (const row of rows) {
  if (ids.has(row.id)) throw new Error(`duplicate id ${row.id}`)
  ids.add(row.id)
}

await writeJsonl(file, rows)
await writeJson(path.join(root, "datasets/raw/generation.json"), {
  version: "1.0.0",
  total: rows.length,
  per_category: countBy(rows, (row) => row.category),
  per_language: countBy(rows, (row) => row.language),
  generators: counters,
})

console.log(`generated ${rows.length} examples into ${path.relative(process.cwd(), file)}`)
console.table(countBy(rows, (row) => row.category))
