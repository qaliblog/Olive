export * as OliveTools from "./tools.js"

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Option, Schema } from "effect"

/**
 * The tool surface a small model can actually use: short names, short descriptions, flat arguments, and results that
 * are compressed before they reach the context window. Every call returns a structured result, so a failed operation is
 * never reported as a success.
 */
export const Name = Schema.Literals([
  "read_file",
  "write_file",
  "edit_file",
  "list_directory",
  "search_code",
  "find_symbols",
  "run_shell",
  "run_tests",
  "install_dependencies",
  "inspect_diagnostics",
  "project_structure",
])
export type Name = typeof Name.Type

export type ErrorCode =
  | "invalid-arguments"
  | "outside-workspace"
  | "not-found"
  | "no-match"
  | "ambiguous-match"
  | "command-failed"
  | "timeout"
  | "io-error"

export interface Failure {
  readonly ok: false
  readonly tool: Name
  readonly error: { readonly code: ErrorCode; readonly message: string }
}

export interface Success {
  readonly ok: true
  readonly tool: Name
  readonly output: string
  readonly truncated?: boolean
  readonly files?: readonly string[]
}

export type Result = Success | Failure

export interface Context {
  /** Every path is resolved against this directory; nothing outside it can be read or written. */
  readonly directory: string
  readonly signal?: AbortSignal
  readonly maxOutputChars?: number
  readonly ignore?: readonly string[]
}

export interface Definition {
  readonly name: Name
  readonly description: string
  readonly parameters: Readonly<Record<string, unknown>>
  readonly run: (input: unknown, context: Context) => Promise<Result>
}

export const DEFAULT_IGNORE = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
] as const

const positive = Schema.Int.check(Schema.isGreaterThan(0))
const offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const Read = Schema.Struct({ path: Schema.String, start: Schema.optional(offset), end: Schema.optional(offset) })
const Write = Schema.Struct({ path: Schema.String, content: Schema.String })
const Edit = Schema.Struct({ path: Schema.String, old: Schema.String, new: Schema.String })
const List = Schema.Struct({ path: Schema.optional(Schema.String) })
const Search = Schema.Struct({ query: Schema.String, path: Schema.optional(Schema.String), max: Schema.optional(positive) })
const Symbols = Schema.Struct({ path: Schema.optional(Schema.String), max: Schema.optional(positive) })
const Shell = Schema.Struct({ command: Schema.String, timeoutMs: Schema.optional(positive) })
const Tests = Schema.Struct({ command: Schema.optional(Schema.String), timeoutMs: Schema.optional(positive) })
const Install = Schema.Struct({ command: Schema.optional(Schema.String), timeoutMs: Schema.optional(positive) })
const Diagnostics = Schema.Struct({ command: Schema.optional(Schema.String), timeoutMs: Schema.optional(positive) })
const Structure = Schema.Struct({ path: Schema.optional(Schema.String), depth: Schema.optional(positive) })

const options = { errors: "all", onExcessProperty: "error" } as const

const parseRead = Schema.decodeUnknownOption(Read, options)
const parseWrite = Schema.decodeUnknownOption(Write, options)
const parseEdit = Schema.decodeUnknownOption(Edit, options)
const parseList = Schema.decodeUnknownOption(List, options)
const parseSearch = Schema.decodeUnknownOption(Search, options)
const parseSymbols = Schema.decodeUnknownOption(Symbols, options)
const parseShell = Schema.decodeUnknownOption(Shell, options)
const parseTests = Schema.decodeUnknownOption(Tests, options)
const parseInstall = Schema.decodeUnknownOption(Install, options)
const parseDiagnostics = Schema.decodeUnknownOption(Diagnostics, options)
const parseStructure = Schema.decodeUnknownOption(Structure, options)

const ok = (tool: Name, output: string, extra: Pick<Success, "truncated" | "files"> = {}): Success => ({
  ok: true,
  tool,
  output,
  ...extra,
})
const fail = (tool: Name, code: ErrorCode, message: string): Failure => ({ ok: false, tool, error: { code, message } })
const relative = (context: Context, file: string) => path.relative(context.directory, file) || "."

function resolve(context: Context, value: string) {
  const root = path.resolve(context.directory)
  const target = path.resolve(root, value.length > 0 ? value : ".")
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return undefined
  return target
}

function bounded(context: Context, text: string) {
  const max = context.maxOutputChars ?? 20_000
  if (text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, max)}\n… (${text.length - max} more characters not shown)`, truncated: true }
}

async function readText(file: string) {
  return readFile(file, "utf8").catch(() => undefined)
}

/** Depth-first file walk bounded by count, used by search, symbols, and the agent's retrieval. */
export async function listFiles(
  root: string,
  options: { readonly ignore?: readonly string[]; readonly max?: number } = {},
) {
  const ignore = options.ignore ?? DEFAULT_IGNORE
  const max = options.max ?? 5_000
  const files: string[] = []
  const queue = [root]
  while (queue.length > 0) {
    const directory = queue.pop()!
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (ignore.includes(entry.name)) continue
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.isFile()) {
        if (files.length >= max) return { files, truncated: true }
        files.push(full)
      }
    }
  }
  return { files, truncated: false }
}

const SymbolPatterns: readonly { readonly extensions: readonly string[]; readonly pattern: RegExp }[] = [
  {
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    pattern: /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  },
  { extensions: [".py"], pattern: /^[ \t]*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/gm },
  { extensions: [".css"], pattern: /^[ \t]*([.#][A-Za-z_][\w-]*)[ \t]*\{/gm },
]

export interface Symbol {
  readonly name: string
  readonly line: number
}

/** Lightweight symbol index. It maps declarations to lines so a function can be fetched instead of a whole file. */
export function symbolsOf(text: string, file: string): Symbol[] {
  const pattern = SymbolPatterns.find((item) => item.extensions.includes(path.extname(file)))
  if (!pattern) return []
  const symbols: Symbol[] = []
  for (const match of text.matchAll(pattern.pattern)) {
    const name = match[1]
    if (!name) continue
    symbols.push({ name, line: text.slice(0, match.index).split("\n").length })
  }
  return symbols
}

/** Extracts the block of one symbol, from its declaration to the next declaration at the same or a lower indent. */
export function symbolText(text: string, symbol: Symbol, symbols: readonly Symbol[], maxLines = 80) {
  const lines = text.split("\n")
  const next = symbols.find((item) => item.line > symbol.line)
  const start = symbol.line - 1
  const indent = (lines[start] ?? "").match(/^\s*/)?.[0].length ?? 0
  const limit = Math.min(next ? next.line - 1 : lines.length, start + maxLines)
  const body: string[] = []
  for (let index = start; index < limit; index++) {
    const line = lines[index] ?? ""
    if (index > start && /^\S/.test(line) && (line.match(/^[ \t]*/)?.[0].length ?? 0) <= indent) break
    body.push(line)
  }
  return body.join("\n")
}

interface Executed {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
  readonly timedOut: boolean
}

async function exec(command: string, context: Context, timeoutMs: number): Promise<Executed> {
  const child = Bun.spawn({
    cmd: ["bash", "-lc", command],
    cwd: context.directory,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  let timedOut = false
  const abort = () => child.kill()
  context.signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, timeoutMs)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { stdout, stderr, code: code ?? -1, timedOut }
  } finally {
    clearTimeout(timer)
    context.signal?.removeEventListener("abort", abort)
  }
}

function commandResult(tool: Name, executed: Executed, context: Context, label: string): Result {
  const body = [executed.stdout.trim(), executed.stderr.trim()].filter((part) => part.length > 0).join("\n") || "(no output)"
  if (executed.timedOut) return fail(tool, "timeout", `${label} timed out`)
  const result = bounded(context, body)
  if (executed.code !== 0) return fail(tool, "command-failed", `${label} exited with code ${executed.code}\n${result.text}`)
  return ok(tool, `${result.text}\n(exit code 0)`, { truncated: result.truncated })
}

async function packageScripts(context: Context) {
  const text = await readText(path.join(context.directory, "package.json"))
  if (text === undefined) return {} as Record<string, string>
  const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text))
  if (decoded === undefined || typeof decoded !== "object" || decoded === null) return {} as Record<string, string>
  const scripts = (decoded as { scripts?: unknown }).scripts
  if (!scripts || typeof scripts !== "object") return {} as Record<string, string>
  return Object.fromEntries(
    Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

async function installCommand(context: Context, requested?: string) {
  if (requested) return requested
  const exists = async (name: string) => (await stat(path.join(context.directory, name)).catch(() => undefined)) !== undefined
  if (await exists("bun.lock")) return "bun install"
  if (await exists("bun.lockb")) return "bun install"
  if (await exists("pnpm-lock.yaml")) return "pnpm install"
  if (await exists("yarn.lock")) return "yarn install"
  if (await exists("package-lock.json")) return "npm ci"
  if (await exists("package.json")) return "npm install"
  return undefined
}

const definitions: readonly Definition[] = [
  {
    name: "read_file",
    description: "Read a text file inside the project. Optional 1-based start and end line numbers.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        start: { type: "integer", minimum: 0 },
        end: { type: "integer", minimum: 0 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseRead(input))
      if (!args) return fail("read_file", "invalid-arguments", "read_file expects { path, start?, end? } with integer lines")
      const target = resolve(context, args.path)
      if (!target) return fail("read_file", "outside-workspace", `${args.path} is outside the project`)
      const text = await readText(target)
      if (text === undefined) return fail("read_file", "not-found", `${args.path} could not be read`)
      const lines = text.split("\n")
      const result = bounded(context, lines.slice(Math.max(0, (args.start ?? 1) - 1), args.end ?? lines.length).join("\n"))
      return ok("read_file", result.text, { truncated: result.truncated })
    },
  },
  {
    name: "write_file",
    description: "Create or replace a file with the given content.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseWrite(input))
      if (!args) return fail("write_file", "invalid-arguments", "write_file expects { path, content }")
      const target = resolve(context, args.path)
      if (!target) return fail("write_file", "outside-workspace", `${args.path} is outside the project`)
      const directory = await mkdir(path.dirname(target), { recursive: true }).catch((cause: unknown) => cause)
      if (directory instanceof Error) return fail("write_file", "io-error", `${args.path}: ${directory.message}`)
      const written = await writeFile(target, args.content, "utf8").catch((cause: unknown) => cause)
      if (written instanceof Error) return fail("write_file", "io-error", `${args.path}: ${written.message}`)
      return ok("write_file", `wrote ${relative(context, target)} (${Buffer.byteLength(args.content)} bytes)`, {
        files: [relative(context, target)],
      })
    },
  },
  {
    name: "edit_file",
    description: "Replace one exact occurrence of old text in a file. Fails when the text is missing or ambiguous.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" } },
      required: ["path", "old", "new"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseEdit(input))
      if (!args) return fail("edit_file", "invalid-arguments", "edit_file expects { path, old, new }")
      if (args.old.length === 0) return fail("edit_file", "invalid-arguments", "old text must not be empty")
      const target = resolve(context, args.path)
      if (!target) return fail("edit_file", "outside-workspace", `${args.path} is outside the project`)
      const text = await readText(target)
      if (text === undefined) return fail("edit_file", "not-found", `${args.path} could not be read`)
      const first = text.indexOf(args.old)
      if (first === -1) return fail("edit_file", "no-match", `${args.path} does not contain the old text`)
      if (text.indexOf(args.old, first + args.old.length) !== -1)
        return fail("edit_file", "ambiguous-match", `${args.path} contains the old text more than once`)
      const written = await writeFile(target, `${text.slice(0, first)}${args.new}${text.slice(first + args.old.length)}`, "utf8").catch(
        (cause: unknown) => cause,
      )
      if (written instanceof Error) return fail("edit_file", "io-error", `${args.path}: ${written.message}`)
      return ok("edit_file", `edited ${relative(context, target)}`, { files: [relative(context, target)] })
    },
  },
  {
    name: "list_directory",
    description: "List the entries of one directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseList(input))
      if (!args) return fail("list_directory", "invalid-arguments", "list_directory expects { path? }")
      const target = resolve(context, args.path ?? ".")
      if (!target) return fail("list_directory", "outside-workspace", `${args.path ?? "."} is outside the project`)
      const entries = await readdir(target, { withFileTypes: true }).catch(() => undefined)
      if (!entries) return fail("list_directory", "not-found", `${args.path ?? "."} could not be listed`)
      const names = entries
        .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
        .toSorted((left, right) => left.localeCompare(right))
      const result = bounded(context, names.join("\n") || "(empty directory)")
      return ok("list_directory", result.text, { truncated: result.truncated })
    },
  },
  {
    name: "search_code",
    description: "Search project text for a literal string and return matching lines.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        max: { type: "integer", minimum: 1 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseSearch(input))
      if (!args) return fail("search_code", "invalid-arguments", "search_code expects { query, path?, max? }")
      if (args.query.length === 0) return fail("search_code", "invalid-arguments", "query must not be empty")
      const root = resolve(context, args.path ?? ".")
      if (!root) return fail("search_code", "outside-workspace", `${args.path ?? "."} is outside the project`)
      const limit = Math.min(args.max ?? 40, 200)
      const { files, truncated: walkTruncated } = await listFiles(root, { ignore: context.ignore ?? DEFAULT_IGNORE })
      const matches: string[] = []
      for (const file of files) {
        if (((await stat(file).catch(() => undefined))?.size ?? 0) > 512 * 1024) continue
        const text = await readText(file)
        if (!text?.includes(args.query)) continue
        for (const [index, line] of text.split("\n").entries()) {
          if (!line.includes(args.query)) continue
          matches.push(`${relative(context, file)}:${index + 1}: ${line.trim().slice(0, 200)}`)
          if (matches.length >= limit) break
        }
        if (matches.length >= limit) break
      }
      if (matches.length === 0) return fail("search_code", "no-match", `no matches for ${args.query}`)
      const result = bounded(context, matches.join("\n"))
      return ok("search_code", result.text, { truncated: result.truncated || walkTruncated || matches.length >= limit })
    },
  },
  {
    name: "find_symbols",
    description: "Index function, class, type, and CSS declarations in project source files.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, max: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseSymbols(input))
      if (!args) return fail("find_symbols", "invalid-arguments", "find_symbols expects { path?, max? }")
      const root = resolve(context, args.path ?? ".")
      if (!root) return fail("find_symbols", "outside-workspace", `${args.path ?? "."} is outside the project`)
      const limit = Math.min(args.max ?? 60, 200)
      const { files } = await listFiles(root, { ignore: context.ignore ?? DEFAULT_IGNORE, max: 2_000 })
      const lines: string[] = []
      for (const file of files) {
        const text = await readText(file)
        if (!text) continue
        for (const symbol of symbolsOf(text, file)) {
          lines.push(`${relative(context, file)}:${symbol.line}: ${symbol.name}`)
          if (lines.length >= limit) break
        }
        if (lines.length >= limit) break
      }
      if (lines.length === 0) return fail("find_symbols", "no-match", "no symbols were found")
      const result = bounded(context, lines.join("\n"))
      return ok("find_symbols", result.text, { truncated: result.truncated || lines.length >= limit })
    },
  },
  {
    name: "run_shell",
    description: "Run a shell command in the project directory and return its output.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1 } },
      required: ["command"],
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseShell(input))
      if (!args) return fail("run_shell", "invalid-arguments", "run_shell expects { command, timeoutMs? }")
      if (args.command.trim().length === 0) return fail("run_shell", "invalid-arguments", "command must not be empty")
      const executed = await exec(args.command, context, args.timeoutMs ?? 120_000)
      return commandResult("run_shell", executed, context, `shell command`)
    },
  },
  {
    name: "run_tests",
    description: "Run the project test script, or a given test command.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseTests(input))
      if (!args) return fail("run_tests", "invalid-arguments", "run_tests expects { command?, timeoutMs? }")
      const scripts = await packageScripts(context)
      const command = args.command ?? (scripts.test ? "bun run test" : "bun test")
      const executed = await exec(command, context, args.timeoutMs ?? 240_000)
      return commandResult("run_tests", executed, context, command)
    },
  },
  {
    name: "install_dependencies",
    description: "Install project dependencies with the package manager detected from the lockfile.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseInstall(input))
      if (!args) return fail("install_dependencies", "invalid-arguments", "install_dependencies expects { command?, timeoutMs? }")
      const command = await installCommand(context, args.command)
      if (!command) return fail("install_dependencies", "not-found", "no package manager files were found")
      const executed = await exec(command, context, args.timeoutMs ?? 300_000)
      return commandResult("install_dependencies", executed, context, command)
    },
  },
  {
    name: "inspect_diagnostics",
    description: "Run the project type check or diagnostics script.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, timeoutMs: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseDiagnostics(input))
      if (!args) return fail("inspect_diagnostics", "invalid-arguments", "inspect_diagnostics expects { command?, timeoutMs? }")
      const scripts = await packageScripts(context)
      const command = args.command ?? (scripts.typecheck ? "bun run typecheck" : scripts.check ? "bun run check" : undefined)
      if (!command)
        return fail(
          "inspect_diagnostics",
          "not-found",
          "no typecheck or check script is defined; pass an explicit command",
        )
      const executed = await exec(command, context, args.timeoutMs ?? 240_000)
      return commandResult("inspect_diagnostics", executed, context, command)
    },
  },
  {
    name: "project_structure",
    description: "Show the project tree to a shallow depth, skipping build and dependency directories.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, depth: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
    run: async (input, context) => {
      const args = Option.getOrUndefined(parseStructure(input))
      if (!args) return fail("project_structure", "invalid-arguments", "project_structure expects { path?, depth? }")
      const root = resolve(context, args.path ?? ".")
      if (!root) return fail("project_structure", "outside-workspace", `${args.path ?? "."} is outside the project`)
      const depth = Math.min(args.depth ?? 2, 5)
      const ignore = context.ignore ?? DEFAULT_IGNORE
      const lines: string[] = []
      const visit = async (directory: string, level: number): Promise<void> => {
        if (level > depth || lines.length >= 300) return
        const entries = (await readdir(directory, { withFileTypes: true }).catch(() => []))
          .filter((entry) => !ignore.includes(entry.name))
          .toSorted((left, right) => Number(right.isDirectory()) - Number(left.isDirectory()) || left.name.localeCompare(right.name))
        for (const entry of entries) {
          if (lines.length >= 300) return
          lines.push(`${"  ".repeat(level)}${entry.name}${entry.isDirectory() ? "/" : ""}`)
          if (entry.isDirectory()) await visit(path.join(directory, entry.name), level + 1)
        }
      }
      await visit(root, 0)
      const result = bounded(context, lines.join("\n") || "(empty directory)")
      return ok("project_structure", result.text, { truncated: result.truncated || lines.length >= 300 })
    },
  },
]

export const tools: readonly Definition[] = definitions

export function find(name: string) {
  return tools.find((tool) => tool.name === name)
}

/** Compact definitions for the model. Descriptions stay short on purpose; parameter schemas carry the detail. */
export function definitionsFor(list: readonly Definition[] = tools) {
  return list.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))
}

export async function execute(name: string, input: unknown, context: Context): Promise<Result> {
  const tool = find(name)
  if (!tool)
    return {
      ok: false,
      tool: name as Name,
      error: { code: "invalid-arguments", message: `unknown tool ${name}` },
    }
  return tool.run(input, context)
}

/** Records what the agent did, so file and command history survives outside the context window. */
export interface Operation {
  readonly tool: string
  readonly ok: boolean
  readonly at: number
  readonly summary: string
}

export function tracker() {
  const operations: Operation[] = []
  return {
    operations,
    record(result: Result) {
      operations.push({
        tool: result.tool,
        ok: result.ok,
        at: Date.now(),
        summary: result.ok ? result.output.split("\n")[0]!.slice(0, 200) : `${result.error.code}: ${result.error.message}`.slice(0, 200),
      })
      return result
    },
  }
}
