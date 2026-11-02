// Terminal branding. Every glyph is built from full blocks and single-cell gaps, so each letter keeps an
// exact cell width in any monospace font and no half-cell seam can break its shape.
export type Wordmark = {
  readonly rows: readonly string[]
  /** The same rows in ASCII, for terminals that cannot measure or draw block characters. */
  readonly ascii: readonly string[]
}

// Fixed cell grids: a letter is never trimmed, so its strokes stay on the same columns in every row.
const letters = {
  o: ["████", "█  █", "█  █", "█  █", "████"],
  l: ["█  ", "█  ", "█  ", "█  ", "███"],
  i: ["███", " █ ", " █ ", " █ ", "███"],
  v: ["█   █", "█   █", "█   █", " █ █ ", "  █  "],
  e: ["████", "█   ", "███ ", "█   ", "████"],
}

// The Go mark shares the same strokes at four rows, so it fits the footer and splash rows it sits in.
const goLetters = {
  g: ["████", "█   ", "█  █", "████"],
  o: ["████", "█  █", "█  █", "████"],
}

// One gap cell between letters keeps every row of a wordmark on the same column grid.
function spell(grids: ReadonlyArray<readonly string[]>): Wordmark {
  const rows = (grids[0] ?? []).map((_, row) => grids.map((grid) => grid[row] ?? "").join(" "))
  return { rows, ascii: rows.map((row) => row.replaceAll("█", "#")) }
}

/** The OLIVE wordmark. */
export const logo = spell([letters.o, letters.l, letters.i, letters.v, letters.e])

/** The wordmark's O on its own, for places too narrow for the whole wordmark. */
export const monogram = spell([letters.o])

/** The Olive Go mark. */
export const go = spell([goLetters.g, goLetters.o])

/** The columns a wordmark occupies. No row is wider. */
export function width(wordmark: Wordmark) {
  return wordmark.rows[0]?.length ?? 0
}
