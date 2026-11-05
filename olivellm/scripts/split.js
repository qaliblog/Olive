#!/usr/bin/env node
/**
 * Assigns deterministic, stratified splits and freezes the held-out evaluation ids.
 *
 *   node olivellm/scripts/split.js
 */
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { countBy, readJsonl, sha1, writeJson, writeJsonl } from "./lib/json.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const source = path.join(root, "datasets/validated/deduplicated.jsonl")
const processed = path.join(root, "datasets/processed")
const heldoutFile = path.join(root, "evaluation/heldout/ids.json")

const rows = await readJsonl(source).then((items) => items.map((item) => item.value))
const categories = [...new Set(rows.map((row) => row.category))].toSorted()

// Held-out ids are selected by a stable hash so the same corpus always yields the same eval set.
const heldout = new Set(
  categories.flatMap((category) =>
    rows
      .filter((row) => row.category === category)
      .toSorted((left, right) => hash(left.id) - hash(right.id))
      .slice(0, Math.min(8, Math.max(2, Math.round(rows.filter((row) => row.category === category).length * 0.06))))
      .map((row) => row.id),
  ),
)

const assigned = rows.map((row) => {
  if (heldout.has(row.id)) return { ...row, split: "heldout" }
  const bucket = hash(row.id) % 100
  const split = bucket < 8 ? "test" : bucket < 16 ? "validation" : "train"
  return { ...row, split }
})

// A category with enough rows must appear in every split, otherwise its metrics are noise.
for (const category of categories) {
  const members = assigned.filter((row) => row.category === category)
  if (members.length < 6) continue
  for (const split of ["validation", "test"]) {
    if (members.some((row) => row.split === split)) continue
    const candidate = members.find((row) => row.split === "train")
    if (candidate) candidate.split = split
  }
}

const splits = {
  train: assigned.filter((row) => row.split === "train"),
  validation: assigned.filter((row) => row.split === "validation"),
  test: assigned.filter((row) => row.split === "test"),
  heldout: assigned.filter((row) => row.split === "heldout"),
}

for (const [name, items] of Object.entries(splits)) await writeJsonl(path.join(processed, `${name}.jsonl`), items)
await writeJson(heldoutFile, {
  description: "Frozen evaluation ids. These records are excluded from training and validation.",
  ids: [...heldout].toSorted(),
})

const files = Object.fromEntries(Object.keys(splits).map((name) => [name, sha1(JSON.stringify(splits[name]))]))

const manifest = {
  version: "1.0.0",
  algorithm: "sha1(id) ranked held-out selection per category, then sha1(id) % 100 for test (< 8) and validation (< 16), leftover to train",
  counts: Object.fromEntries(Object.entries(splits).map(([name, items]) => [name, items.length])),
  per_category: Object.fromEntries(
    categories.map((category) => [
      category,
      Object.fromEntries(
        Object.entries(splits).map(([name, items]) => [name, items.filter((row) => row.category === category).length]),
      ),
    ]),
  ),
  language: countBy(assigned, (row) => row.language),
  files,
}
await writeJson(path.join(processed, "split-manifest.json"), manifest)

console.log("split counts:", manifest.counts)
console.log("heldout ids:", heldout.size)

function hash(id) {
  return Number.parseInt(createHash("sha1").update(id).digest("hex").slice(0, 8), 16)
}
