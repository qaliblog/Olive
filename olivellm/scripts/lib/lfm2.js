/**
 * A reimplementation of the LFM2.5 chat template, transcribed from
 * https://huggingface.co/LiquidAI/LFM2.5-350M/raw/main/chat_template.jinja on 2026-11-05.
 *
 * Only the parts Olive needs are implemented: system message with the tool list, plain user/tool messages, assistant
 * messages with text plus native tool calls, and the generation prompt. Thinking blocks and the continuation tag are
 * deliberately omitted because Olive never sends or asks for them.
 *
 * This has never been run against the real tokenizer: byte parity with `apply_chat_template` is a separate, still
 * open check (see documentation/model_findings.md).
 */

export const BOS = "<|startoftext|>"
export const IM_START = "<|im_start|>"
export const IM_END = "<|im_end|>"
export const TOOL_START = "<|tool_call_start|>"
export const TOOL_END = "<|tool_call_end|>"

/** `format_arg_value`: single quotes for strings, bare scalars otherwise. */
export function formatArgumentValue(value) {
  if (typeof value === "string")
    return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "\\n").replaceAll("\r", "\\r")}'`
  if (value === null) return "None"
  if (value === true) return "True"
  if (value === false) return "False"
  return String(value)
}

/** `"name(arg='value', n=3)"`; arguments must be a mapping, exactly as the template requires. */
export function renderCall(call) {
  if (typeof call.arguments === "string")
    throw new Error(`tool call arguments for ${call.name} must be a mapping, not a JSON string`)
  const args = Object.entries(call.arguments).map(([name, value]) => `${name}=${formatArgumentValue(value)}`)
  return `${call.name}(${args.join(", ")})`
}

export function renderToolCalls(calls) {
  return `${TOOL_START}[${calls.map(renderCall).join(", ")}]${TOOL_END}`
}

/**
 * Python's `json.dumps` separators, which is what the template's `tojson` produces for the tool list.
 * Key order is insertion order so tool parameter order is preserved.
 */
export function pythonJson(value) {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(", ")}]`
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${pythonJson(item)}`)
      .join(", ")}}`
  return JSON.stringify(value)
}

/** The `tools` argument is a list of `{ name, description, parameters }` objects. */
export function renderTools(tools) {
  return `List of tools: [${tools.map((tool) => pythonJson(tool)).join(", ")}]`
}

export function renderMessage(message) {
  const content = typeof message.content === "string" ? message.content : pythonJson(message.content)
  const calls = message.toolCalls?.length ? renderToolCalls(message.toolCalls) : ""
  return `${IM_START}${message.role}\n${content}${calls}${IM_END}\n`
}

/**
 * Renders a full conversation. `messages[0]` must be the system message when one exists; that is the only place the
 * template allows it, and the tool list is appended there.
 */
export function render({ messages, tools = [], addGenerationPrompt = false, bos = true }) {
  const [first, ...rest] = messages
  const system = first?.role === "system" ? first : undefined
  const body = system ? rest : messages
  const systemText = [system?.content ?? "", tools.length > 0 ? renderTools(tools) : ""]
    .filter((part) => part.length > 0)
    .join("\n")
  return [
    bos ? BOS : "",
    systemText.length > 0 ? `${IM_START}system\n${systemText}${IM_END}\n` : "",
    ...body.map(renderMessage),
    addGenerationPrompt ? `${IM_START}assistant\n` : "",
  ].join("")
}

/** The exact span an SFT loss should cover: the assistant turn without the trailing `<|im_end|>\n`. */
export function assistantTarget({ text, toolCalls = [] }) {
  return `${text}${toolCalls.length > 0 ? renderToolCalls(toolCalls) : ""}`
}
