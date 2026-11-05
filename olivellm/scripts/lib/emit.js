import { SYSTEM } from "./prompt.js"
import { workspaceOf } from "./projects.js"
import { initialize, progress } from "./state.js"
import { pad } from "./rng.js"

/** Fixed epoch so regenerating the dataset does not change every `updated` field. */
export const EPOCH = 1762300000000

export function makeId(category, slug, language, index) {
  return `olive.${category}.${slug}.${language}.${pad(index)}`
}

export function success(tool, output, extra = {}) {
  return { ok: true, tool, output, ...extra }
}

export function failure(tool, code, message) {
  return { ok: false, tool, error_code: code, output: message }
}

/** The exact line the model sees in `Recent tool results:`. */
export function rendered(result) {
  return result.ok ? `${result.tool} ok\n${result.output}` : `${result.tool} failed (${result.error_code})\n${result.output}`
}

/**
 * Builds one record and checks the invariants that must hold no matter which generator produced it:
 * at most two calls, results paired with calls in order, and a task state that is the real fold of those results.
 */
export function makeExample(input) {
  const {
    id,
    category,
    language,
    difficulty,
    objective,
    project,
    state,
    conversation = [],
    code = [],
    priorResults = [],
    plan = [],
    calls = [],
    results = [],
    response,
    generator,
    seed,
    workspace,
    notes = "",
  } = input

  if (calls.length > 2) throw new Error(`${id}: more than two calls per step`)
  if (results.length > 0 && results.length !== calls.length) throw new Error(`${id}: results are not paired with calls`)
  results.forEach((result, index) => {
    if (result.tool !== calls[index].name) throw new Error(`${id}: result ${index} does not belong to call ${index}`)
    if (typeof result.index !== "number") result.index = index
  })

  const task = state ?? initialize(objective, EPOCH + seed)
  const folded = results.reduce((current, result) => progress(current, result, EPOCH + seed), task)

  return {
    id,
    version: "1.0.0",
    category,
    language,
    difficulty,
    objective,
    system: input.system ?? SYSTEM,
    context: {
      task_state: task,
      conversation,
      code,
      tool_results: priorResults.map(rendered),
      workspace: workspace ?? (project ? workspaceOf(project) : []),
    },
    expected_plan: plan,
    expected_tool_calls: calls.map((call) => ({ name: call.name, arguments: call.arguments, why: call.why })),
    expected_tool_results: results.map((result) => ({
      index: result.index,
      tool: result.tool,
      ok: result.ok,
      output: result.output,
      ...(result.error_code ? { error_code: result.error_code } : {}),
      ...(result.files ? { files: result.files } : {}),
    })),
    expected_task_state: folded,
    expected_response: {
      kind: calls.length > 0 ? "tool_call" : "text",
      text: response.text,
      completion: response.completion ?? "continue",
    },
    validation: { status: "unverified", checks: [], notes, commands: [] },
    source: { kind: "template", generator, seed },
    split: input.split ?? "train",
  }
}
