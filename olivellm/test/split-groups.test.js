import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { assignSplits, groupKeyOf } from "../scripts/lib/split-groups.js"

const root = path.resolve(import.meta.dir, "..")
const rows = await readFile(path.join(root, "datasets/validated/deduplicated.jsonl"), "utf8")
  .then((text) => text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line)))

describe("group-based splitting", () => {
  test("no group appears in more than one split", () => {
    const { splits } = assignSplits(rows)
    const owners = new Map()
    for (const [name, items] of Object.entries(splits)) {
      for (const row of items) {
        const key = groupKeyOf(row)
        const previous = owners.get(key)
        expect(previous === undefined || previous === name).toBe(true)
        owners.set(key, name)
      }
    }
    expect(owners.size).toBe(new Set(rows.map(groupKeyOf)).size)
  })

  test("every record lands in exactly one split", () => {
    const { splits } = assignSplits(rows)
    const seen = new Set()
    for (const items of Object.values(splits)) for (const row of items) seen.add(row.id)
    expect(seen.size).toBe(rows.length)
    expect([...seen].toSorted()).toEqual(rows.map((row) => row.id).toSorted())
  })

  test("the split is deterministic", () => {
    const first = assignSplits(rows)
    const second = assignSplits(rows)
    expect(JSON.stringify(first.splits)).toBe(JSON.stringify(second.splits))
  })

  test("categories with enough rows are represented in validation and test", () => {
    const { splits } = assignSplits(rows)
    const counts = new Map()
    for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1)
    for (const [category, size] of counts) {
      if (size < 6) continue
      expect(splits.validation.some((row) => row.category === category)).toBe(true)
      expect(splits.test.some((row) => row.category === category)).toBe(true)
    }
  })

  test("held-out ids never appear in training or validation", () => {
    const { splits } = assignSplits(rows)
    const frozen = new Set(splits.heldout.map((row) => row.id))
    expect(splits.train.some((row) => frozen.has(row.id))).toBe(false)
    expect(splits.validation.some((row) => frozen.has(row.id))).toBe(false)
    expect(splits.test.some((row) => frozen.has(row.id))).toBe(false)
  })
})
