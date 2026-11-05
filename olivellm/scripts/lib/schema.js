import path from "node:path"

/**
 * A small JSON Schema validator for the subset these schemas use: type, enum, const, required, properties,
 * additionalProperties: false, items, min/max length, pattern, minimum/maximum, min/max items, anyOf and local or
 * cross-file $ref. It exists so validation does not add a dependency; it is not a general purpose validator.
 */
export function validate(schema, value, options = {}) {
  const context = { registry: options.registry ?? {}, root: options.root ?? schema }
  return check(schema, value, "$", context)
}

function check(schema, value, at, context) {
  if (schema === true || schema === undefined) return []
  if (schema === false) return [{ path: at, message: "no value is allowed here" }]
  if (schema.$ref) {
    const resolved = resolve(schema.$ref, context, at)
    if (resolved.error) return [resolved.error]
    return check(resolved.schema, value, at, { ...context, root: resolved.root })
  }
  const errors = []
  if (schema.anyOf) {
    const attempts = schema.anyOf.map((option) => check(option, value, at, context))
    if (!attempts.some((attempt) => attempt.length === 0))
      errors.push({ path: at, message: `does not match any allowed shape (${attempts.map((attempt) => attempt[0]?.message).join(" | ")})` })
  }
  if (schema.type && !hasType(schema.type, value)) errors.push({ path: at, message: `expected ${schema.type}, got ${describe(value)}` })
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value))
    errors.push({ path: at, message: `expected ${JSON.stringify(schema.const)}` })
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value)))
    errors.push({ path: at, message: `${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}` })
  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength)
      errors.push({ path: at, message: `shorter than ${schema.minLength} characters` })
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength)
      errors.push({ path: at, message: `longer than ${schema.maxLength} characters` })
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value))
      errors.push({ path: at, message: `does not match ${schema.pattern}` })
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path: at, message: `less than ${schema.minimum}` })
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path: at, message: `greater than ${schema.maximum}` })
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path: at, message: `fewer than ${schema.minItems} items` })
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path: at, message: `more than ${schema.maxItems} items` })
    if (schema.items) value.forEach((item, index) => errors.push(...check(schema.items, item, `${at}[${index}]`, context)))
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? [])
      if (!(key in value)) errors.push({ path: `${at}.${key}`, message: "is required" })
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key]
      if (property) errors.push(...check(property, item, `${at}.${key}`, context))
      else if (schema.additionalProperties === false) errors.push({ path: `${at}.${key}`, message: "is not an allowed property" })
    }
  }
  return errors
}

function hasType(type, value) {
  const types = Array.isArray(type) ? type : [type]
  return types.some((item) => {
    if (item === "null") return value === null
    if (item === "array") return Array.isArray(value)
    if (item === "object") return value !== null && typeof value === "object" && !Array.isArray(value)
    if (item === "integer") return Number.isInteger(value)
    return typeof value === item || (item === "number" && typeof value === "number")
  })
}

function describe(value) {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

/** Resolves `#/$defs/x`, `file.schema.json` and `file.schema.json#/$defs/x`. */
function resolve(reference, context, at) {
  const [file, pointer = ""] = reference.split("#")
  const root = file.length === 0 ? context.root : context.registry[path.basename(file)]
  if (!root) return { error: { path: at, message: `unknown schema reference ${reference}` } }
  const segments = pointer.split("/").filter((segment) => segment.length > 0).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
  const target = segments.reduce((node, segment) => (node === undefined ? undefined : node[segment]), root)
  if (target === undefined) return { error: { path: at, message: `unresolved schema reference ${reference}` } }
  return { schema: target, root }
}
