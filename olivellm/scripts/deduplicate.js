#!/usr/bin/env node
/**
 * Removes exact and near duplicates from the validated set and records every removal with its reason.
 *
 *   node olivellm/scripts/deduplicate.js
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { countBy, readJsonl, writeJsonl } from "./lib/json.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const source = path.join(root, "datasets/validated/validated.jsonl")
const accepted = path.join(root, "datasets/validated/deduplicated.jsonl")
const rejected = path.join(root, "datasets/rejected/rejected-duplicates.jsonl")

const rows = await readJsonl(source)
const kept = []
const duplicates = []
const byFingerprint = new Map()
const byCategory = new Map()

for (const { value: row } of rows) {
  const fingerprint = `${JSON.stringify(row.expected_tool_calls)}|${JSON.stringify(row.expected_tool_results)}|${normalize(row.expected_response.text)}`
  if (byFingerprint.has(fingerprint)) {
    duplicates.push({ ...describe(row), reasons: [`same tool calls, results and answer as ${byFingerprint.get(fingerprint)}`], example: row })
    continue
  }
  const bucket = byCategory.get(row.category) ?? []
  const near = bucket.find((other) => similarity(text(other), text(row)) >= 0.9)
  if (near) {
    duplicates.push({ ...describe(row), reasons: [`near duplicate of ${near} (>= 0.9 word shingle overlap)`], example: row })
    continue
  }
  byFingerprint.set(fingerprint, row.id)
  bucket.push(row)
  byCategory.set(row.category, bucket)
  kept.push(row)
}

await writeJsonl(accepted, kept)
await writeJsonl(rejected, duplicates)
console.log(`kept ${kept.length}/${rows.length}, removed ${duplicates.length} duplicates`)
if (duplicates.length > 0) console.log("removed per category:", countBy(duplicates, (item) => item.category))

function describe(row) {
  return { id: row.id, category: row.category, language: row.language }
}

function text(row) {
  return normalize(`${row.objective}\n${row.expected_response.text}\n${JSON.stringify(row.expected_tool_calls)}`)
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim()
}

/** Jaccard overlap of word five-shingles, which is stable for short records. */
function similarity(left, right) {
  const a = shingles(left)
  const b = shingles(right)
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const item of a) if (b.has(item)) shared += 1
  return shared / (a.size + b.size - shared)
}

function shingles(text) {
  const words = text.split(" ")
  const result = new Set()
  for (let index = 0; index + 4 < words.length; index += 1) result.add(words.slice(index, index + 5).join(" "))
  if (result.size === 0) result.add(text)
  return result
}
