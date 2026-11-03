export * as OliveAgent from "./agent.js"

import { Option, Schema } from "effect"
import path from "node:path"
import { OliveContextBudget } from "./context-budget.js"
import { OliveModel } from "./model.js"
import { OlivePrompt } from "./prompt.js"
import { OliveProvider } from "./provider.js"
import { OliveTaskState } from "./task-state.js"
import { OliveTools } from "./tools.js"

/**
 * The Olive coding agent. It is deliberately small-model shaped: one step is one short prompt and one tool call, the
 * durable task state is updated and persisted after every operation, and files are written incrementally rather than
 * regenerated as a whole. The conversation is only a cache; the state file is the source of truth.
 */
export const WORKFLOW = [
  "analyze requirements",
  "write an implementation plan",
  "create project directories",
  "write initial files",
  "implement remaining files",
  "install dependencies",
  "run diagnostics",
  "fix errors",
  "verify the result",
] as const

export type Event =
  | { readonly type: "step"; readonly step: number; readonly tokens: number }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool"; readonly result: OliveTools.Result }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "done"; readonly text: string; readonly completed: boolean }

export interface Options {
  readonly registry: OliveProvider.Registry
  readonly directory: string
  readonly objective: string
  /** `provider/model`, a bare model id, or omitted for the document default. */
  readonly requested?: string
  readonly state: OliveTaskState.Store
  readonly fetch?: typeof globalThis.fetch
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly maxSteps?: number
  readonly maxOutput?: number
  readonly signal?: AbortSignal
  readonly onEvent?: (event: Event) => void
  readonly tools?: readonly OliveTools.Definition[]
}

export interface Outcome {
  readonly task: OliveTaskState.TaskState
  readonly steps: number
  readonly text: string
  /** Tool failures, in order. Empty when every operation succeeded. */
  readonly failures: readonly OliveTools.Failure[]
  /** True when the agent stopped on its own without a tool failure or provider error. */
  readonly completed: boolean
  readonly error?: string
}

export const stateFile = (directory: string) => path.join(directory, ".olive", "task.json")

const decodeArguments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

/** One assistant step: a short prompt in, text and tool calls out. Retries once with a smaller code budget on overflow. */
interface Asked {
  readonly text: string
  readonly calls: readonly OliveProvider.ToolCall[]
  readonly tokens: number
}

async function ask(
  adapter: OliveModel.ModelAdapter,
  resolution: OliveModel.Resolution,
  options: Options,
  task: OliveTaskState.TaskState,
  history: readonly OliveProvider.ChatMessage[],
  toolResults: readonly string[],
): Promise<Asked | Error> {
  const attempt = async (reduced: boolean): Promise<Asked> => {
    const plan = OliveContextBudget.plan({
      context: adapter.descriptor.context,
      maxOutput: Math.min(adapter.descriptor.maxOutput, options.maxOutput ?? adapter.descriptor.maxOutput),
      ...(reduced ? { allocation: { code: 0.15, conversation: 0.1 } } : {}),
    })
    const built = OlivePrompt.build({
      plan,
      task,
      code: await retrieve(options.directory, task),
      conversation: history,
      toolResults,
    })
    const text: string[] = []
    const calls: OliveProvider.ToolCall[] = []
    for await (const event of adapter.chat({
      model: resolution.model,
      messages: built.messages,
      ...(adapter.descriptor.tools ? { tools: OliveTools.definitionsFor(options.tools) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })) {
      if (event.type === "text") text.push(event.text)
      if (event.type === "tool-call") calls.push({ id: event.id, name: event.name, arguments: event.arguments })
    }
    return { text: text.join(""), calls, tokens: OlivePrompt.tokens(built) }
  }
  const first = await attempt(false).catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))))
  if (!(first instanceof OliveProvider.ProviderDiagnostic) || first.code !== "context-overflow") return first
  return attempt(true).catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))))
}

export async function run(options: Options): Promise<Outcome> {
  const resolution = OliveModel.resolve(options.registry, options.requested)
  if (resolution instanceof OliveProvider.ProviderDiagnostic) throw resolution
  const adapter = OliveModel.adapter(resolution.provider, resolution.model.id, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.env ? { env: options.env } : {}),
  })
  const context: OliveTools.Context = {
    directory: options.directory,
    maxOutputChars: 4_000,
    ...(options.signal ? { signal: options.signal } : {}),
  }
  const maxSteps = options.maxSteps ?? 12
  const history: OliveProvider.ChatMessage[] = []
  const toolResults: string[] = []
  const failures: OliveTools.Failure[] = []
  const operations = OliveTools.tracker()
  let task = initialize(await options.state.read(), options.objective)
  await options.state.write(task)

  for (let step = 1; step <= maxSteps; step++) {
    const asked = await ask(adapter, resolution, options, task, history, toolResults).catch((cause: unknown) =>
      cause instanceof Error ? cause : new Error(String(cause)),
    )
    if (asked instanceof OliveProvider.ProviderDiagnostic) {
      task = await options.state.write(
        advance(task, {
          errors: [...task.errors.slice(-9), `${asked.code}: ${asked.message}`.slice(0, 300)],
          next: "resolve the provider error before continuing",
        }),
      )
      await options.state.write(task)
      options.onEvent?.({ type: "error", message: asked.message })
      return { task, steps: step, text: "", failures, completed: false, error: asked.message }
    }
    if (asked instanceof Error) throw asked
    options.onEvent?.({ type: "step", step, tokens: asked.tokens })
    if (asked.text.length > 0) options.onEvent?.({ type: "text", text: asked.text })
    history.push({
      role: "assistant",
      content: asked.text,
      ...(asked.calls.length > 0 ? { toolCalls: asked.calls } : {}),
    })

    // A small model gets a couple of calls per step at most; more becomes noise it cannot track.
    const calls = asked.calls.slice(0, 2)
    if (calls.length === 0) {
      task = await options.state.write(advance(task, { next: "report the result" }))
      await options.state.write(task)
      const completed = failures.length === 0
      options.onEvent?.({ type: "done", text: asked.text, completed })
      return { task, steps: step, text: asked.text, failures, completed }
    }

    for (const call of calls) {
      const input = Option.getOrUndefined(decodeArguments(call.arguments)) ?? call.arguments
      const result = operations.record(await OliveTools.execute(call.name, input, context))
      options.onEvent?.({ type: "tool", result })
      if (!result.ok) failures.push(result)
      toolResults.push(
        result.ok
          ? `${result.tool} ok\n${result.output}`
          : `${result.tool} failed (${result.error.code})\n${result.error.message}`,
      )
      task = await options.state.write(progress(task, result))
    }
  }
  task = await options.state.write(
    advance(task, { errors: [...task.errors.slice(-9), `step limit reached after ${maxSteps} steps`], next: "review the remaining work" }),
  )
  await options.state.write(task)
  const message = `step limit reached after ${maxSteps} steps; the task state is saved and can be resumed`
  options.onEvent?.({ type: "error", message })
  return { task, steps: maxSteps, text: "", failures, completed: false, error: message }
}

function initialize(state: OliveTaskState.TaskState | undefined, objective: string) {
  if (!state || state.objective !== objective)
    return OliveTaskState.apply(OliveTaskState.create(objective), { plan: WORKFLOW, remaining: WORKFLOW })
  if (state.plan.length === 0) return OliveTaskState.apply(state, { plan: WORKFLOW, remaining: state.remaining.length > 0 ? state.remaining : WORKFLOW })
  return state
}

function advance(task: OliveTaskState.TaskState, update: OliveTaskState.Update) {
  const next = OliveTaskState.apply(task, update)
  const completed = new Set(next.completed)
  return { ...next, remaining: next.plan.filter((step) => !completed.has(step)) }
}

const retry: Readonly<Record<string, string>> = {
  write_file: "fix the failed write and continue",
  edit_file: "re-read the file and retry the edit",
  run_shell: "inspect the command error and retry",
  run_tests: "fix the failing tests",
  inspect_diagnostics: "fix the reported diagnostics",
  install_dependencies: "resolve the dependency install failure",
}

/** Folds one tool result into the durable task state. Only real, successful work is marked complete. */
function progress(task: OliveTaskState.TaskState, result: OliveTools.Result) {
  if (!result.ok)
    return advance(task, {
      errors: [...task.errors.slice(-9), `${result.tool}: ${result.error.code}: ${result.error.message}`.slice(0, 300)],
      next: retry[result.tool] ?? "recover from the failed operation",
    })
  if (result.tool === "write_file")
    return advance(task, {
      files: result.files ?? [],
      completed: [...task.completed, "write initial files"],
      next: "implement remaining files",
    })
  if (result.tool === "edit_file")
    return advance(task, { files: result.files ?? [], completed: [...task.completed, "fix errors"], next: "run diagnostics" })
  if (result.tool === "install_dependencies")
    return advance(task, {
      completed: [...task.completed, "install dependencies"],
      next: "run diagnostics",
    })
  if (result.tool === "inspect_diagnostics" || result.tool === "run_tests")
    return advance(task, {
      verification: [`${result.tool} passed`],
      completed: [...task.completed, "run diagnostics", "verify the result"],
      next: "report the result",
    })
  if (result.tool === "find_symbols")
    return advance(task, {
      symbols: result.output.split("\n").flatMap((line) => {
        const symbol = line.split(": ").pop()
        return symbol && symbol !== line ? [symbol] : []
      }),
      next: "implement remaining files",
    })
  if (result.tool === "read_file" || result.tool === "search_code")
    return advance(task, { completed: [...task.completed, "analyze requirements"], next: "write an implementation plan" })
  return task
}

/**
 * Symbol-level retrieval for the files the task is touching. It returns a symbol summary plus the bodies of symbols
 * named by the objective, plan, or errors, never a whole file.
 */
async function retrieve(directory: string, task: OliveTaskState.TaskState): Promise<OliveContextBudget.Item[]> {
  const wanted = new Set(
    [task.objective, ...task.plan, ...task.remaining, task.next ?? "", ...task.errors]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9_$]+/)
      .filter((word) => word.length > 2),
  )
  const items: OliveContextBudget.Item[] = []
  for (const file of task.files.slice(-5)) {
    const text = await Bun.file(path.join(directory, file)).text().catch(() => undefined)
    if (!text) continue
    const symbols = OliveTools.symbolsOf(text, file)
    if (symbols.length === 0) continue
    items.push({
      id: `symbols:${file}`,
      kind: "summary",
      file,
      priority: 1,
      text: `${file} declares: ${symbols.slice(0, 20).map((symbol) => symbol.name).join(", ")}`,
    })
    for (const symbol of symbols.filter((symbol) => wanted.has(symbol.name.toLowerCase())).slice(0, 3))
      items.push({
        id: `${file}:${symbol.name}`,
        kind: "symbol",
        file,
        priority: 3,
        text: `${file}:${symbol.line}\n${OliveTools.symbolText(text, symbol, symbols)}`,
      })
  }
  return items
}
