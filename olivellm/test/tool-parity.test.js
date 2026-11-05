import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveTools } from "../../packages/core/src/olive/tools.ts"
import { validate } from "../scripts/lib/schema.js"

/**
 * Runtime parity for the tool catalog.
 *
 * The dataset ships one JSON Schema per tool. It must describe the tools Olive actually runs, not a copy that drifted.
 * This checks the declarations field by field and then probes the real executor: every argument object the schema
 * accepts has to reach the tool, and every object it rejects has to come back as `invalid-arguments`.
 */
const catalog = await Bun.file(path.join(import.meta.dir, "../schemas/tool_call.schema.json")).json()
const definitions = OliveTools.definitionsFor()

const sample = {
  path: "a.txt",
  content: "x",
  old: "x",
  new: "y",
  query: "x",
  command: "true",
  start: 1,
  end: 1,
  max: 1,
  depth: 1,
  timeoutMs: 2000,
}

/** Tools that run a command get one that cannot hang or touch the real project. */
const required = (schema) => schema.required ?? []

function minimal(schema) {
  return Object.fromEntries(required(schema).map((key) => [key, sample[key]]))
}

function probes(name, schema) {
  const base = minimal(schema)
  const list = [{ label: "minimal", value: base }]
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    list.push({ label: `${key} set`, value: { ...base, [key]: sample[key] } })
    if (property.minLength === 1) list.push({ label: `${key} empty`, value: { ...base, [key]: "" } })
    if (property.minimum !== undefined) list.push({ label: `${key} below minimum`, value: { ...base, [key]: property.minimum - 1 } })
    if (property.type === "integer") list.push({ label: `${key} fractional`, value: { ...base, [key]: 2.5 } })
    if (property.type === "string") list.push({ label: `${key} wrong type`, value: { ...base, [key]: 7 } })
  }
  for (const key of required(schema)) {
    const copy = { ...base }
    delete copy[key]
    list.push({ label: `${key} missing`, value: copy })
  }
  list.push({ label: "unknown property", value: { ...base, unexpected: true } })
  return list.map((probe) => ({ ...probe, name }))
}

let directory
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "olive-parity-"))
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe("tool schema parity", () => {
  test("the dataset catalog lists exactly the runtime tools", () => {
    expect(catalog.properties.name.enum).toEqual(definitions.map((tool) => tool.name))
    expect(Object.keys(catalog.$defs)).toEqual(definitions.map((tool) => tool.name))
  })

  for (const tool of definitions) {
    test(`${tool.name} declaration matches the runtime definition`, () => {
      const definition = catalog.$defs[tool.name]
      expect(definition).toBeDefined()
      expect(definition.description).toBe(tool.description)
      expect(stable(definition.parameters)).toBe(stable(tool.parameters))
    })
  }

  test("the runtime accepts exactly the arguments the schema accepts", async () => {
    const disagreements = []
    for (const tool of definitions) {
      const definition = catalog.$defs[tool.name]
      for (const probe of probes(tool.name, definition.parameters)) {
        const schemaValid = validate(definition.parameters, probe.value).length === 0
        const result = await OliveTools.execute(tool.name, probe.value, { directory })
        const rejectedArguments = !result.ok && result.error.code === "invalid-arguments"
        if (schemaValid === rejectedArguments) {
          disagreements.push(
            `${tool.name} (${probe.label}): schema ${schemaValid ? "accepts" : "rejects"} but runtime ${
              rejectedArguments ? "rejects the arguments" : result.ok ? "ran it" : `returned ${result.error.code}`
            }`,
          )
        }
      }
    }
    expect(disagreements).toEqual([])
  })
})

/** Key-sorted JSON so property order in a declaration never decides parity. */
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`
  return JSON.stringify(value)
}
