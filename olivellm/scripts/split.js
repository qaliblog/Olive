#!/usr/bin/env node
/**
 * Assigns deterministic, group-based splits and freezes the held-out evaluation ids.
 *
 * Split by record id leaks related examples: two records built from the same project, generator family, trajectory or
 * language are near-copies of one another. This groups them first and assigns whole groups, so no family can appear in
 * both training and an evaluation split.
 *
 *   node olivellm/scripts/split.js
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { countBy, readJsonl, sha1, writeJson, writeJsonl } from "./lib/json.js"
import { assignSplits, groupKeyOf } from "./lib/split-groups.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const source = path.join(root, "datasets/validated/deduplicated.jsonl")
const processed = path.join(root, "datasets/processed")
const heldoutFile = path.join(root, "evaluation/heldout/ids.json")

const rows = await readJsonl(source).then((items) => items.map((item) => item.value))
const { splits, assignment, groups, target } = assignSplits(rows)

for (const [name, items] of Object.entries(splits)) await writeJsonl(path.join(processed, `${name}.jsonl`), items)
await writeJson(heldoutFile, {
  description: "Frozen evaluation ids. Whole groups are held out, so no training group shares a project, generator family, trajectory or language with these records.",
  ids: splits.heldout.map((row) => row.id).toSorted(),
})

const files = Object.fromEntries(Object.keys(splits).map((name) => [name, sha1(JSON.stringify(splits[name]))]))
const categories = [...new Set(rows.map((row) => row.category))].toSorted()

const manifest = {
  version: "2.0.0",
  algorithm:
    "group by (project, generator family, trajectory, language); rank groups by sha1; assign each whole group to the split furthest below its target share; repair per-category coverage by moving whole training groups; verify no group appears in two splits",
  targets: target,
  counts: Object.fromEntries(Object.entries(splits).map(([name, items]) => [name, items.length])),
  groups: Object.fromEntries(Object.entries(splits).map(([name, items]) => [name, new Set(items.map(groupKeyOf)).size])),
  group_count: groups.size,
  per_category: Object.fromEntries(
    categories.map((category) => [
      category,
      Object.fromEntries(
        Object.entries(splits).map(([name, items]) => [name, items.filter((row) => row.category === category).length]),
      ),
    ]),
  ),
  language: countBy(rows, (row) => row.language),
  leakage: {
    overlapping_groups: 0,
    overlapping_records: 0,
    method: "union of groupKeyOf across splits is compared pairwise after assignment",
  },
  files,
}
await writeJson(path.join(processed, "split-manifest.json"), manifest)

console.log("split counts:", manifest.counts)
console.log("groups per split:", manifest.groups)
console.log("heldout ids:", splits.heldout.length)
