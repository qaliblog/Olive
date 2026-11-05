/**
 * Mirror of packages/core/src/olive/task-state.ts and the `advance`/`progress` functions in
 * packages/core/src/olive/agent.ts. `scripts/validate.js --parity` re-derives every example's expected state through
 * this module, so a drift between this file and the agent shows up as a rejected example.
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
]

export const RETRY_HINTS = {
  write_file: "fix the failed write and continue",
  edit_file: "re-read the file and retry the edit",
  run_shell: "inspect the command error and retry",
  run_tests: "fix the failing tests",
  inspect_diagnostics: "fix the reported diagnostics",
  install_dependencies: "resolve the dependency install failure",
}

const unique = (values) => Array.from(new Set(values.filter((value) => value.length > 0)))

export function create(objective, now = 0) {
  return { objective, plan: [], completed: [], remaining: [], files: [], symbols: [], pending: [], verification: [], errors: [], updated: now }
}

export function apply(state, update, now = 0) {
  return {
    objective: update.objective ?? state.objective,
    ...(update.project ?? state.project ? { project: update.project ?? state.project } : {}),
    plan: update.plan ? unique(update.plan) : state.plan,
    completed: update.completed ? unique(update.completed) : state.completed,
    remaining: update.remaining ? unique(update.remaining) : state.remaining,
    files: update.files ? unique([...state.files, ...update.files]) : state.files,
    symbols: update.symbols ? unique([...state.symbols, ...update.symbols]) : state.symbols,
    pending: update.pending ? unique(update.pending) : state.pending,
    verification: update.verification ? unique(update.verification) : state.verification,
    errors: update.errors ? unique(update.errors) : state.errors,
    ...(update.next !== undefined ? { next: update.next } : state.next !== undefined ? { next: state.next } : {}),
    updated: now,
  }
}

export function complete(state, step, now = 0) {
  return apply(
    state,
    { completed: [...state.completed, step], remaining: state.remaining.filter((item) => item !== step), next: state.remaining.find((item) => item !== step) },
    now,
  )
}

/** `advance` in agent.ts: recompute `remaining` from the plan after every fold. */
export function advance(task, update, now = 0) {
  const next = apply(task, update, now)
  const completed = new Set(next.completed)
  return { ...next, remaining: next.plan.filter((step) => !completed.has(step)) }
}

/**
 * `progress` in agent.ts. `result` is the tool result in its compact form:
 * `{ tool, ok, output, files?, error?: { code, message } }`.
 */
export function progress(task, result, now = 0) {
  // Dataset records store a failure as `{ error_code, output }`; the runtime result uses `{ error: { code, message } }`.
  const code = result.error?.code ?? result.error_code ?? "error"
  const message = result.error?.message ?? result.output ?? ""
  if (!result.ok)
    return advance(
      task,
      {
        errors: [...task.errors.slice(-9), `${result.tool}: ${code}: ${message}`.slice(0, 300)],
        next: RETRY_HINTS[result.tool] ?? "recover from the failed operation",
      },
      now,
    )
  if (result.tool === "write_file")
    return advance(task, { files: result.files ?? [], completed: [...task.completed, "write initial files"], next: "implement remaining files" }, now)
  if (result.tool === "edit_file") return advance(task, { files: result.files ?? [], next: "run diagnostics" }, now)
  if (result.tool === "install_dependencies")
    return advance(task, { completed: [...task.completed, "install dependencies"], next: "run diagnostics" }, now)
  if (result.tool === "inspect_diagnostics")
    return advance(
      task,
      {
        verification: [...task.verification, "inspect_diagnostics passed"],
        completed: [...task.completed, "run diagnostics", ...(task.errors.length > 0 ? ["fix errors"] : [])],
        errors: [],
        next: "verify the result",
      },
      now,
    )
  if (result.tool === "run_tests")
    return advance(
      task,
      {
        verification: [...task.verification, "run_tests passed"],
        completed: [...task.completed, "verify the result", ...(task.errors.length > 0 ? ["fix errors"] : [])],
        errors: [],
        next: "report the result",
      },
      now,
    )
  if (result.tool === "find_symbols")
    return advance(
      task,
      {
        symbols: result.output.split("\n").flatMap((line) => {
          const symbol = line.split(": ").pop()
          return symbol && symbol !== line ? [symbol] : []
        }),
        next: "implement remaining files",
      },
      now,
    )
  if (result.tool === "read_file" || result.tool === "search_code")
    return advance(task, { completed: [...task.completed, "analyze requirements"], next: "write an implementation plan" }, now)
  return task
}

/** `summarize` in task-state.ts, byte for byte. */
export function summarize(state) {
  const list = (label, values) => (values.length === 0 ? `${label}: none` : `${label}: ${values.join("; ")}`)
  return [
    `Objective: ${state.objective}`,
    state.project ? `Project: ${state.project}` : undefined,
    list("Plan", state.plan),
    list("Done", state.completed),
    list("Remaining", state.remaining),
    list("Files", state.files),
    list("Symbols", state.symbols),
    list("Pending", state.pending),
    list("Verified", state.verification),
    list("Errors", state.errors),
    state.next ? `Next: ${state.next}` : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

/** Seeds the state exactly as `initialize` does for a new objective. */
export function initialize(objective, now = 0) {
  return apply(create(objective, now), { plan: WORKFLOW, remaining: WORKFLOW }, now)
}
