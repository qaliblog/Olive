/**
 * Parser for the LFM2.5 tool-call block. Used by the evaluation scorer and by the agent harness, so scoring and
 * execution never disagree about what the model emitted.
 */

export function parseGeneration(text) {
  const block = /<\|tool_call_start\|>\[([\s\S]*?)\]<\|tool_call_end\|>/.exec(text)
  if (!block) return { calls: [], invalid: false, text: text.length > 0 }
  const items = splitTopLevel(block[1], ",")
  const calls = []
  let invalid = false
  for (const item of items) {
    const call = parseCall(item.trim())
    if (call) calls.push(call)
    else invalid = true
  }
  return { calls, invalid }
}

function parseCall(source) {
  const match = /^([A-Za-z_]\w*)\(([\s\S]*)\)$/.exec(source)
  if (!match) return undefined
  const [, name, body] = match
  const args = {}
  for (const pair of splitTopLevel(body, ",")) {
    const trimmed = pair.trim()
    if (trimmed.length === 0) continue
    const equals = trimmed.indexOf("=")
    if (equals === -1) return undefined
    const key = trimmed.slice(0, equals).trim()
    if (!/^[A-Za-z_]\w*$/.test(key)) return undefined
    const value = parseValue(trimmed.slice(equals + 1).trim())
    if (value === undefined) return undefined
    args[key] = value
  }
  return { name, arguments: args }
}

function parseValue(source) {
  if (source.startsWith("'") && source.endsWith("'"))
    return source
      .slice(1, -1)
      .replaceAll("\\\\n", "\n")
      .replaceAll("\\\\r", "\r")
      .replaceAll("\\\\'", "'")
      .replaceAll("\\\\\\\\", "\\")
  if (source === "True") return true
  if (source === "False") return false
  if (source === "None") return null
  if (/^-?\d+$/.test(source)) return Number(source)
  if (/^-?\d+\.\d+$/.test(source)) return Number(source)
  if (source.startsWith("{") || source.startsWith("[")) {
    try {
      return JSON.parse(source.replaceAll("True", "true").replaceAll("False", "false").replaceAll("None", "null"))
    } catch {
      return undefined
    }
  }
  return undefined
}

export function splitTopLevel(text, separator) {
  const parts = []
  let depth = 0
  let quote = ""
  let current = ""
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quote) {
      if (character === "\\") {
        current += character + (text[index + 1] ?? "")
        index += 1
        continue
      }
      if (character === quote) quote = ""
      current += character
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      current += character
      continue
    }
    if (character === "(" || character === "{" || character === "[") depth += 1
    if (character === ")" || character === "}" || character === "]") depth -= 1
    if (character === separator && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }
    current += character
  }
  if (current.trim().length > 0) parts.push(current)
  return parts
}
