import { createHash } from "node:crypto"

/**
 * Group-based splitting. An example from one project, one generator family, one trajectory or one language is related
 * to its siblings, so splitting by record id leaks those siblings across the boundary. Every record therefore belongs
 * to exactly one group and a whole group is assigned to one split.
 */
const TARGETS = { heldout: 0.09, test: 0.08, validation: 0.08, train: 0.75 }
const ORDER = ["heldout", "test", "validation", "train"]

/** Stable grouping key. `trajectory` keeps the steps of one real trace together even across generators. */
export function groupKeyOf(row) {
  const project = row.expected_task_state?.project ?? "none"
  const family = row.source?.generator ?? "unknown"
  const scenario = row.source?.trajectory ?? row.source?.kind ?? "template"
  return `${project}|${family}|${scenario}|${row.language}`
}

export function rank(key) {
  return Number.parseInt(createHash("sha1").update(key).digest("hex").slice(0, 8), 16)
}

/**
 * Assigns whole groups to train/validation/test/heldout, then repairs category coverage without ever splitting a
 * group. Deterministic: the same rows always produce the same assignment.
 */
export function assignSplits(rows) {
  const groups = new Map()
  for (const row of rows) {
    const key = groupKeyOf(row)
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  const ranked = [...groups.keys()].toSorted((left, right) => rank(left) - rank(right) || left.localeCompare(right))
  const target = Object.fromEntries(
    Object.entries(TARGETS).map(([name, share]) => [name, Math.max(1, Math.round(rows.length * share))]),
  )
  const counts = { train: 0, validation: 0, test: 0, heldout: 0 }
  const assignment = new Map()
  for (const key of ranked) {
    // The split furthest below its target takes the group; ORDER breaks ties so map order never matters.
    const pick = [...ORDER].toSorted(
      (left, right) => counts[left] / target[left] - counts[right] / target[right] || ORDER.indexOf(left) - ORDER.indexOf(right),
    )[0]
    assignment.set(key, pick)
    counts[pick] += groups.get(key).length
  }

  coverCategories(groups, ranked, assignment)

  const splits = { train: [], validation: [], test: [], heldout: [] }
  for (const [key, members] of groups) for (const row of members) splits[assignment.get(key)].push(row)
  for (const name of Object.keys(splits)) splits[name] = splits[name].toSorted((left, right) => left.id.localeCompare(right.id))

  const overlap = findOverlap(splits)
  if (overlap.length > 0) throw new Error(`group leakage between splits: ${overlap.slice(0, 3).join(", ")}`)

  return { splits, assignment, groups, overlap, target }
}

/**
 * A category with enough rows has to appear in every evaluation split, otherwise its metric is noise. Moving a whole
 * training group keeps the no-overlap invariant.
 */
function coverCategories(groups, ranked, assignment) {
  const byCategory = new Map()
  for (const [key, members] of groups) {
    for (const row of members) {
      const entry = byCategory.get(row.category) ?? new Set()
      entry.add(key)
      byCategory.set(row.category, entry)
    }
  }
  for (const [category, keys] of byCategory) {
    const size = [...keys].reduce((total, key) => total + groups.get(key).length, 0)
    if (size < 6) continue
    for (const split of ["validation", "test", "heldout"]) {
      if ([...keys].some((key) => assignment.get(key) === split)) continue
      const candidate = ranked.find(
        (key) =>
          keys.has(key) &&
          assignment.get(key) === "train" &&
          groups.get(key).every((row) => !ranked.some((other) => assignment.get(other) === split && other === groupKeyOf(row))),
      )
      if (candidate) assignment.set(candidate, split)
      else throw new Error(`category ${category} cannot be represented in ${split} without splitting a group`)
    }
  }
}

/** Real leakage check on the produced splits, not on the assignment bookkeeping. */
function findOverlap(splits) {
  const sets = Object.fromEntries(
    Object.entries(splits).map(([name, items]) => [name, new Set(items.map(groupKeyOf))]),
  )
  const overlap = []
  const names = Object.keys(sets)
  for (const [left, right] of names.flatMap((left, index) => names.slice(index + 1).map((right) => [left, right]))) {
    for (const key of sets[left]) if (sets[right].has(key)) overlap.push(`${key} (${left} and ${right})`)
  }
  const ids = Object.fromEntries(Object.entries(splits).map(([name, items]) => [name, new Set(items.map((row) => row.id))]))
  for (const [left, right] of names.flatMap((left, index) => names.slice(index + 1).map((right) => [left, right]))) {
    const shared = [...ids[left]].filter((id) => ids[right].has(id))
    if (shared.length > 0) overlap.push(`record ${shared[0]} in ${left} and ${right}`)
  }
  return overlap
}
