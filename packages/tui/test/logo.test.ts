import { expect, test } from "bun:test"
import { go, logo, monogram, width } from "../src/logo"
import { stringWidth } from "../src/util/string-width"

// The artwork is fixed, so the expected rows double as the shape contract: a stroke that moves or a gap
// that grows shows up here instead of in a terminal.
const expected = {
  logo: ["████ █   ███ █   █ ████", "█  █ █    █  █   █ █   ", "█  █ █    █  █   █ ███ ", "█  █ █    █   █ █  █   ", "████ ███ ███   █   ████"],
  monogram: ["████", "█  █", "█  █", "█  █", "████"],
  go: ["████ ████", "█    █  █", "█  █ █  █", "████ ████"],
}

test.each([
  ["logo", logo],
  ["monogram", monogram],
  ["go", go],
] as const)("%s keeps one column grid across every row", (name, wordmark) => {
  expect(wordmark.rows).toEqual(expected[name])
  const columns = width(wordmark)
  for (const row of wordmark.rows) {
    // A short row would shift the letters after it, and an ambiguous-width block would widen the wordmark
    // in terminals that measure it as two cells.
    expect(Array.from(row)).toHaveLength(columns)
    expect(stringWidth(row)).toBe(columns)
  }
})

test.each([
  ["logo", logo],
  ["monogram", monogram],
  ["go", go],
] as const)("%s draws only full blocks and gaps", (_, wordmark) => {
  for (const row of wordmark.rows) expect(row).toMatch(/^[█ ]+$/)
  for (const row of wordmark.ascii) expect(row).toMatch(/^[# ]+$/)
})

test.each([
  ["logo", logo],
  ["monogram", monogram],
  ["go", go],
] as const)("%s keeps the ASCII fallback on the same grid", (_, wordmark) => {
  expect(wordmark.ascii).toHaveLength(wordmark.rows.length)
  wordmark.ascii.forEach((row, index) => expect(row).toBe(wordmark.rows[index]!.replaceAll("█", "#")))
})

test("the wordmark stays narrower than the layouts that show it", () => {
  // Home and Stats center it beside two columns of padding; the compact lockup covers the widths below.
  expect(width(logo)).toBe(23)
})
