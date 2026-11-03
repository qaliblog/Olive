export * as OliveTaskState from "./task-state.js"

import { mkdir, rename } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"

/**
 * The durable part of an agent task. It lives outside the model context, so compaction or a restart loses only the
 * conversation, never the objective, plan, or what has already been verified.
 */
export const TaskState = Schema.Struct({
  objective: Schema.String,
  project: Schema.optional(Schema.String),
  plan: Schema.Array(Schema.String),
  completed: Schema.Array(Schema.String),
  remaining: Schema.Array(Schema.String),
  /** Files currently being created or modified. */
  files: Schema.Array(Schema.String),
  /** Discovered symbols worth carrying into later prompts. */
  symbols: Schema.Array(Schema.String),
  pending: Schema.Array(Schema.String),
  verification: Schema.Array(Schema.String),
  errors: Schema.Array(Schema.String),
  next: Schema.optional(Schema.String),
  updated: Schema.Number,
})
export type TaskState = typeof TaskState.Type

export interface Update {
  readonly objective?: string
  readonly project?: string
  readonly plan?: readonly string[]
  readonly completed?: readonly string[]
  readonly remaining?: readonly string[]
  readonly files?: readonly string[]
  readonly symbols?: readonly string[]
  readonly pending?: readonly string[]
  readonly verification?: readonly string[]
  readonly errors?: readonly string[]
  readonly next?: string
}

export function create(objective: string, now = Date.now()): TaskState {
  return {
    objective,
    plan: [],
    completed: [],
    remaining: [],
    files: [],
    symbols: [],
    pending: [],
    verification: [],
    errors: [],
    updated: now,
  }
}

const unique = (values: readonly string[]) => Array.from(new Set(values.filter((value) => value.length > 0)))

/** Applies an update, deduplicating file and symbol lists so repeated tool calls do not grow the state. */
export function apply(state: TaskState, update: Update, now = Date.now()): TaskState {
  return {
    objective: update.objective ?? state.objective,
    project: update.project ?? state.project,
    plan: update.plan ? unique(update.plan) : state.plan,
    completed: update.completed ? unique(update.completed) : state.completed,
    remaining: update.remaining ? unique(update.remaining) : state.remaining,
    files: update.files ? unique([...state.files, ...update.files]) : state.files,
    symbols: update.symbols ? unique([...state.symbols, ...update.symbols]) : state.symbols,
    pending: update.pending ? unique(update.pending) : state.pending,
    verification: update.verification ? unique(update.verification) : state.verification,
    errors: update.errors ? unique(update.errors) : state.errors,
    next: update.next ?? state.next,
    updated: now,
  }
}

/** Records a finished plan step, keeping `remaining` in sync with what the agent still has to do. */
export function complete(state: TaskState, step: string, now = Date.now()) {
  return apply(
    state,
    {
      completed: [...state.completed, step],
      remaining: state.remaining.filter((item) => item !== step),
      next: state.remaining.find((item) => item !== step),
    },
    now,
  )
}

const decode = Schema.decodeUnknownOption(TaskState)
const decodeJSON = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

export function decodeState(input: unknown) {
  return Option.getOrUndefined(decode(input))
}

export function encode(state: TaskState) {
  return `${JSON.stringify(Schema.encodeSync(TaskState)(state), null, 2)}\n`
}

export async function read(file: string) {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return undefined
  const value = Option.getOrUndefined(decodeJSON(await handle.text()))
  return value === undefined ? undefined : decodeState(value)
}

/** Writes through a temporary file so an interrupted write never leaves a half-written state behind. */
export async function write(file: string, state: TaskState) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${crypto.randomUUID()}.tmp`
  await Bun.write(temporary, encode(state))
  await rename(temporary, file)
}

export interface Store {
  readonly read: () => Promise<TaskState | undefined>
  readonly write: (state: TaskState) => Promise<TaskState>
  readonly update: (update: Update) => Promise<TaskState>
  readonly complete: (step: string) => Promise<TaskState>
}

/** A file-backed task state, the durable half of a coding task across compaction and restarts. */
export function store(file: string, objective: string): Store {
  const load = async () => (await read(file)) ?? create(objective)
  return {
    read: () => read(file),
    write: async (state) => {
      await write(file, state)
      return state
    },
    update: async (update) => {
      const next = apply(await load(), update)
      await write(file, next)
      return next
    },
    complete: async (step) => {
      const next = complete(await load(), step)
      await write(file, next)
      return next
    },
  }
}

/** A compact rendering for the model's task section; the full state stays on disk. */
export function summarize(state: TaskState) {
  const list = (label: string, values: readonly string[]) =>
    values.length === 0 ? `${label}: none` : `${label}: ${values.join("; ")}`
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
    .filter((line): line is string => line !== undefined)
    .join("\n")
}
