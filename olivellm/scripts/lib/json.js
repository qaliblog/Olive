import { createHash } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"

export async function readJsonl(file) {
  const text = await readFile(file, "utf8").catch((cause) => {
    if (cause.code === "ENOENT") return ""
    throw cause
  })
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => ({ line: index + 1, value: parse(line, file, index) }))
}

function parse(line, file, index) {
  try {
    return JSON.parse(line)
  } catch (cause) {
    throw new Error(`${file}:${index + 1}: invalid JSON (${cause.message})`)
  }
}

/** Writes through a temporary file so an interrupted run never leaves a half-written dataset. */
export async function writeJsonl(file, rows) {
  await mkdir(path.dirname(file), { recursive: true })
  const body = rows.map((row) => JSON.stringify(row)).join("\n")
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, rows.length === 0 ? "" : `${body}\n`, "utf8")
  await rename(temporary, file)
}

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"))
}

export function sha1(value) {
  return createHash("sha1").update(value).digest("hex")
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex")
}

/**
 * Token estimate in the same unit as Olive's context budget: Latin text averages four characters per token,
 * non-Latin scripts count three quarter-units per code point. Keep this in sync with
 * packages/core/src/olive/context-budget.ts.
 */
export function estimateTokens(text) {
  if (text.length === 0) return 0
  const nonAscii = text.match(/[^\x00-\x7f]/g)?.length ?? 0
  return Math.max(1, Math.ceil((text.length - nonAscii + nonAscii * 3) / 4))
}

/** Stable serialisation used for dedup keys and fingerprints. */
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}

export function sortedObject(value) {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .toSorted()
        .map((key) => [key, sortedObject(value[key])]),
    )
  return value
}

export function groupBy(rows, key) {
  const groups = new Map()
  for (const row of rows) {
    const value = key(row)
    groups.set(value, [...(groups.get(value) ?? []), row])
  }
  return groups
}

export function countBy(rows, key) {
  return Object.fromEntries([...groupBy(rows, key)].map(([value, items]) => [value, items.length]))
}
