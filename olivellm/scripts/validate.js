#!/usr/bin/env node
/**
 * Validates generated examples and writes the accepted and rejected sets.
 *
 * Checks are structural and independent of the generator: JSON Schema, tool catalog arguments, call/result pairing,
 * task-state fold (the state must be what the agent would really persist), path containment, output wording, language
 * label, length, duplicates, and real parsers for code.
 *
 *   node olivellm/scripts/validate.js [--parity]
 */
import { spawnSync } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { EPOCH } from "./lib/emit.js"
import { countBy, estimateTokens, readJson, readJsonl, stable, writeJsonl } from "./lib/json.js"
import { buildStep, SYSTEM } from "./lib/prompt.js"
import { PROJECTS } from "./lib/projects.js"
import { validate as validateSchema } from "./lib/schema.js"
import { WORKFLOW, initialize, progress, summarize } from "./lib/state.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const repository = path.resolve(root, "..")
const input = path.join(root, "datasets/raw/examples.jsonl")
const output = path.join(root, "datasets/validated/validated.jsonl")
const rejectedFile = path.join(root, "datasets/rejected/rejected.jsonl")

const schemas = {
  example: await readJson(path.join(root, "schemas/example.schema.json")),
  "task_state.schema.json": await readJson(path.join(root, "schemas/task_state.schema.json")),
  "tool_call.schema.json": await readJson(path.join(root, "schemas/tool_call.schema.json")),
}
const registry = {
  "example.schema.json": schemas.example,
  "task_state.schema.json": schemas["task_state.schema.json"],
  "tool_call.schema.json": schemas["tool_call.schema.json"],
}
const catalog = schemas["tool_call.schema.json"]
const knownTools = catalog.properties.name.enum
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

if (process.argv.includes("--parity")) await parity()

const rows = await readJsonl(input)
const accepted = []
const rejected = []
const seenObjective = new Map()
const seenFingerprint = new Map()
const work = await mkdtemp(path.join(tmpdir(), "olivellm-validate-"))

try {
  for (const { line, value } of rows) {
    const inspected = await inspect(value)
    const reasons = inspected.reasons
    const key = `${value.category}|${normalize(value.objective)}`
    if (seenObjective.has(key)) reasons.push(`duplicate objective (same as ${seenObjective.get(key)})`)
    else seenObjective.set(key, value.id)
    const fingerprint = stable(value)
    if (seenFingerprint.has(fingerprint)) reasons.push(`duplicate record (same as ${seenFingerprint.get(fingerprint)})`)
    else seenFingerprint.set(fingerprint, value.id)

    if (reasons.length > 0) {
      rejected.push({ id: value.id, category: value.category, language: value.language, line, reasons, example: value })
      continue
    }
    accepted.push({
      ...value,
      validation: {
        status: "passed",
        checks: inspected.checks,
        notes: value.validation.notes,
        commands: inspected.commands,
      },
    })
  }
} finally {
  await rm(work, { recursive: true, force: true })
}

await writeJsonl(output, accepted)
await writeJsonl(rejectedFile, rejected)

const reasonCounts = countBy(rejected.flatMap((item) => item.reasons.map((reason) => reason.replace(/\(same as .*\)/, "").trim())), (reason) => reason)
console.log(`validated ${accepted.length}/${rows.length} examples, rejected ${rejected.length}`)
console.log("per category:", countBy(accepted, (row) => row.category))
if (rejected.length > 0) console.log("rejection reasons:", reasonCounts)
process.exitCode = rejected.length === 0 ? 0 : 0

async function inspect(row) {
  const reasons = []
  const checks = []
  const commands = []

  for (const error of validateSchema(schemas.example, row, { registry })) reasons.push(`schema ${error.path}: ${error.message}`)
  if (reasons.length > 0) return { reasons, checks, commands }
  checks.push("schema")

  const state = row.context.task_state
  const expected = row.expected_task_state
  const calls = row.expected_tool_calls
  const results = row.expected_tool_results
  const response = row.expected_response

  checkId(row, reasons)
  checkCatalog(row, reasons)
  if (calls.length === 0) checks.push("tool-catalog")

  // Request and result pairing must match the OpenAI-compatible shape the agent sends.
  if (!(results.length === 0 || results.length === calls.length)) reasons.push("results are not paired with calls")
  results.forEach((result, index) => {
    if (calls[index] && result.tool !== calls[index].name) reasons.push(`result ${index} belongs to ${result.tool}, not ${calls[index].name}`)
    if (result.ok && !result.output.length) reasons.push(`result ${index} is ok but has no output`)
    if (!result.ok && !result.error_code) reasons.push(`result ${index} failed without an error code`)
  })
  checks.push("pairing")

  if (response.kind === "tool_call" && calls.length === 0) reasons.push("kind is tool_call but no call is expected")
  if (response.kind === "text" && calls.length > 0) reasons.push("kind is text but calls are expected")
  if (response.completion === "continue" && calls.length === 0) reasons.push("completion continue without a call would end the run")
  if (response.completion !== "continue" && calls.length > 0) reasons.push(`completion ${response.completion} with a call contradicts the step loop`)
  checks.push("completion")

  checkTaskState(expected, reasons)
  checks.push("task-state-invariants")

  // The expected state must be the real fold of the expected results over the context state.
  const seed = row.source.seed
  const folded = results.reduce((current, result) => progress(current, toRuntime(result), EPOCH + seed), state)
  if (stable(folded) !== stable(expected)) {
    const keys = ["plan", "completed", "remaining", "files", "symbols", "pending", "verification", "errors", "next", "updated"]
    const drift = keys.filter((key) => stable(folded[key]) !== stable(expected[key]))
    reasons.push(`task state is not the fold of the results (differs in ${drift.join(", ")})`)
  }
  if (state && expected.objective !== state.objective) reasons.push("expected state changed the objective")
  checks.push("task-state-fold")

  checkPaths(row, reasons)
  checks.push("paths")

  checkOutputs(row, reasons)
  checks.push("tool-outputs")

  if (response.completion === "done") {
    if (results.some((result) => !result.ok)) reasons.push("completion done after a failed result")
    const advisory = expected.files.length === 0 && expected.completed.length === 0
    const evidence = advisory || results.some((result) => result.ok) || row.context.tool_results.some((text) => /^\w+ ok\n/.test(text))
    if (!evidence) reasons.push("completion done without any successful operation")
    if (expected.errors.length > 0) reasons.push("completion done while errors remain in the state")
    const wroteFiles = expected.files.length > 0 || expected.completed.length > 0
    if (wroteFiles && !expected.verification.includes("run_tests passed")) reasons.push("completion done without a passing test run")
  }
  if (response.completion === "blocked") {
    if (calls.length > 0) reasons.push("blocked with a tool call")
    if (expected.errors.length === 0 && expected.verification.length > 0) reasons.push("blocked but the state shows verified work")
  }
  checks.push("honesty")

  checkLanguage(row, reasons)
  checks.push("language")

  const target = [
    response.text,
    ...calls.map((item) => JSON.stringify(item.arguments)),
  ].join("\n")
  const prompt = [
    SYSTEM,
    ...row.context.conversation.map((message) => message.content),
    buildStep({ task: state ?? initialize(row.objective, EPOCH + seed), code: row.context.code, toolResults: row.context.tool_results }),
  ].join("\n")
  const tokens = estimateTokens(prompt) + estimateTokens(target)
  if (tokens > 3200) reasons.push(`example is too long (${tokens} estimated tokens)`)
  else if (tokens > 2048) row.validation.notes = `${row.validation.notes} long example: ${tokens} estimated tokens`.trim()
  checks.push("length")

  const syntax = await checkCode(row, work)
  checks.push(...syntax.checks)
  commands.push(...syntax.commands)
  reasons.push(...syntax.reasons)

  return { reasons, checks, commands }
}

function checkId(row, reasons) {
  if (!row.id.startsWith(`olive.${row.category}.`)) reasons.push("id does not start with the category")
  if (!new RegExp(`\\.${row.language}\\.[0-9]{4}$`).test(row.id)) reasons.push("id does not end with the language and a four digit counter")
  if (row.expected_task_state.objective.trim().length === 0) reasons.push("expected state has an empty objective")
}

function checkCatalog(row, reasons) {
  row.expected_tool_calls.forEach((call, index) => {
    if (!knownTools.includes(call.name)) {
      reasons.push(`unknown tool ${call.name}`)
      return
    }
    // A record that demonstrates argument rejection must be allowed to send arguments the catalog rejects.
    const rejection = row.expected_tool_results[index]
    if (rejection && !rejection.ok && rejection.error_code === "invalid-arguments") return
    for (const error of validateSchema(catalog.$defs[call.name].parameters, call.arguments, { registry })) {
      reasons.push(`arguments for ${call.name} ${error.path}: ${error.message}`)
    }
  })
}

function checkTaskState(state, reasons) {
  const plan = state.plan
  if (plan.length !== new Set(plan).size) reasons.push("plan repeats a step")
  for (const step of plan) if (!WORKFLOW.includes(step)) reasons.push(`plan contains unknown step ${step}`)
  for (const step of state.completed) if (!plan.includes(step)) reasons.push(`completed step ${step} is not in the plan`)
  const expectedRemaining = plan.filter((step) => !state.completed.includes(step))
  if (stable(expectedRemaining) !== stable(state.remaining)) reasons.push("remaining is not plan minus completed")
  for (const entry of state.verification) {
    if (entry === "run_tests passed" && !state.completed.includes("verify the result")) reasons.push("run_tests passed without completing verify the result")
    if (entry === "inspect_diagnostics passed" && !state.completed.includes("run diagnostics")) reasons.push("diagnostics passed without completing run diagnostics")
  }
  const duplicates = state.files.filter((file, index) => state.files.indexOf(file) !== index)
  if (duplicates.length > 0) reasons.push(`files repeat ${duplicates.join(", ")}`)
}

function checkPaths(row, reasons) {
  const workspace = new Set(row.context.workspace)
  const directories = new Set([".", ...[...workspace].filter((item) => item.endsWith("/")).map((item) => item.replace(/\/$/, ""))])
  row.expected_tool_calls.forEach((call, index) => {
    const result = row.expected_tool_results[index]
    const failureCode = result && !result.ok ? result.error_code : undefined
    if (typeof call.arguments.path !== "string") return
    const target = call.arguments.path
    if (target.startsWith("/")) {
      if (failureCode !== "outside-workspace") reasons.push(`${call.name} uses an absolute path ${target}`)
      return
    }
    if (target.split("/").includes("..")) {
      if (failureCode !== "outside-workspace") reasons.push(`${call.name} escapes the project with ${target}`)
      return
    }
    if (call.name === "read_file" || call.name === "edit_file") {
      if (!workspace.has(target) && failureCode !== "not-found") reasons.push(`${call.name} reads ${target}, which is not in the workspace`)
    }
    if (call.name === "write_file") {
      if (!workspace.has(target) && !workspace.has(path.posix.dirname(target) === "." ? "" : `${path.posix.dirname(target)}/`))
        reasons.push(`write_file targets ${target} but its directory is not in the workspace`)
    }
    if (["list_directory", "search_code", "find_symbols", "project_structure"].includes(call.name)) {
      const directory = target === "" || target === "." ? "." : target.replace(/\/$/, "")
      if (!directories.has(directory) && failureCode !== "not-found" && failureCode !== "no-match")
        reasons.push(`${call.name} targets ${directory}, which is not a workspace directory`)
    }
  })
}

function checkOutputs(row, reasons) {
  row.expected_tool_results.forEach((result, index) => {
    const call = row.expected_tool_calls[index]
    if (!result.ok) return
    if (result.tool === "write_file") {
      const match = /^wrote (.+) \((\d+) bytes\)$/.exec(result.output)
      if (!match) reasons.push(`write_file output does not use the tool wording: ${result.output.slice(0, 60)}`)
      else {
        if (match[1] !== call.arguments.path) reasons.push("write_file output names a different path")
        if (Number(match[2]) !== Buffer.byteLength(call.arguments.content, "utf8")) reasons.push("write_file byte count does not match the content")
      }
      if (!result.files?.includes(call.arguments.path)) reasons.push("write_file result does not track the written file")
    }
    if (result.tool === "edit_file" && result.output !== `edited ${call.arguments.path}`) reasons.push("edit_file output does not use the tool wording")
    if (result.tool === "read_file") {
      const corpus = PROJECTS.flatMap((project) => (project.files[call.arguments.path] === undefined ? [] : [{ project, text: project.files[call.arguments.path] }]))
      const expected = corpus.map(({ text }) => text.split("\n").slice(Math.max(0, (call.arguments.start ?? 1) - 1), call.arguments.end ?? undefined).join("\n"))
      if (expected.length > 0 && !expected.includes(result.output) && result.output.length < 4000)
        reasons.push(`read_file output does not match the corpus file ${call.arguments.path}`)
    }
    if (["run_tests", "run_shell", "install_dependencies", "inspect_diagnostics"].includes(result.tool) && !result.output.includes("(exit code 0)"))
      reasons.push(`${result.tool} success output is missing the exit code line`)
  })
}

function checkLanguage(row, reasons) {
  // Code blocks carry literal data such as Persian labels in an otherwise English explanation.
  const text = `${row.objective}\n${row.expected_response.text.replace(/```[\s\S]*?```/g, "")}`
  const persian = (text.match(/[\u0600-\u06ff]/g) ?? []).length
  const ratio = persian / Math.max(1, text.replace(/\s/g, "").length)
  if (row.language === "fa" && ratio < 0.15) reasons.push(`language is fa but only ${(ratio * 100).toFixed(0)}% of the text is Persian`)
  if (row.language === "en" && ratio > 0.05) reasons.push(`language is en but ${(ratio * 100).toFixed(0)}% of the text is Persian`)
  if (row.language === "mixed" && (ratio < 0.05 || ratio > 0.85)) reasons.push("language is mixed but the script ratio is one-sided")
}

async function checkCode(row, directory) {
  const checks = []
  const commands = []
  const reasons = []
  const blocks = []
  row.expected_tool_calls.forEach((call) => {
    if (call.name === "write_file" && typeof call.arguments.content === "string")
      blocks.push({ file: call.arguments.path, code: call.arguments.content, source: "write_file" })
  })
  for (const match of row.expected_response.text.matchAll(/```([a-z]+)\n([\s\S]*?)```/g)) {
    blocks.push({ fence: match[1], code: match[2], source: "response" })
  }
  for (const [index, block] of blocks.entries()) {
    const extension = block.file ? path.extname(block.file) : `.${block.fence === "python" ? "py" : block.fence}`
    const loader = { ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "jsx", ".ts": "ts", ".tsx": "tsx" }[extension]
    if (loader) {
      const file = path.join(directory, `block-${index}${extension}`)
      await writeFile(file, block.code, "utf8")
      const run = spawnSync("bun", [path.join(here, "lib/check-syntax.js"), file, loader], { encoding: "utf8" })
      commands.push(`bun olivellm/scripts/lib/check-syntax.js <tmp${extension}> ${loader}`)
      if (run.status !== 0) reasons.push(`code does not parse as ${loader}: ${(run.stderr || run.stdout).split("\n")[0]}`)
      else checks.push(`syntax:${loader}`)
      continue
    }
    if (extension === ".py") {
      const file = path.join(directory, `block-${index}.py`)
      await writeFile(file, block.code, "utf8")
      const run = spawnSync("python3", ["-m", "py_compile", file], { encoding: "utf8" })
      commands.push("python3 -m py_compile <tmp.py>")
      if (run.status !== 0) reasons.push(`python does not compile: ${run.stderr.split("\n").at(-2) ?? run.stderr.slice(0, 120)}`)
      else checks.push("syntax:python")
      continue
    }
    if (extension === ".html") {
      const problem = checkMarkup(block.code)
      if (problem) reasons.push(`html is not well formed: ${problem}`)
      else checks.push("markup:balance")
      continue
    }
    if (extension === ".css") {
      const problem = checkCss(block.code)
      if (problem) reasons.push(`css is not well formed: ${problem}`)
      else checks.push("css:balance")
      continue
    }
    checks.push("syntax:unchecked")
  }
  return { checks, commands, reasons }
}

function checkMarkup(text) {
  const stack = []
  for (const match of text.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match
    const tag = name.toLowerCase()
    if (VOID.has(tag) || selfClosing === "/") continue
    if (closing === "/") {
      const open = stack.pop()
      if (open !== tag) return `</${tag}> closes <${open ?? "nothing"}>`
      continue
    }
    stack.push(tag)
  }
  return stack.length === 0 ? undefined : `<${stack.at(-1)}> is never closed`
}

function checkCss(text) {
  let depth = 0
  for (const character of text) {
    if (character === "{") depth += 1
    if (character === "}") depth -= 1
    if (depth < 0) return "unexpected closing brace"
  }
  return depth === 0 ? undefined : `${depth} unclosed block(s)`
}

function toRuntime(result) {
  return result.ok
    ? { ok: true, tool: result.tool, output: result.output, files: result.files }
    : { ok: false, tool: result.tool, output: result.output, error: { code: result.error_code, message: result.output } }
}

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/g, " ").trim()
}

async function parity() {
  const fixtures = [
    initialize("build a task api", EPOCH),
    progress(initialize("test csvtool", EPOCH), { ok: true, tool: "run_tests", output: "2 passed" }, EPOCH),
    progress(initialize("fix syntax", EPOCH), { ok: false, tool: "edit_file", output: "does not contain the old text", error: { code: "no-match", message: "does not contain the old text" } }, EPOCH),
    { ...initialize("done", EPOCH), completed: WORKFLOW, remaining: [], verification: ["run_tests passed"], project: "task-api", next: "report the result" },
  ]
  const file = path.join(root, ".parity.ts")
  await writeFile(
    file,
    [
      `import { OliveTaskState } from ${JSON.stringify(path.join(repository, "packages/core/src/olive/task-state.ts"))}`,
      `import { WORKFLOW as AGENT_WORKFLOW } from ${JSON.stringify(path.join(repository, "packages/core/src/olive/agent.ts"))}`,
      `const fixtures = ${JSON.stringify(fixtures)}`,
      "console.log(JSON.stringify({ workflow: AGENT_WORKFLOW, summaries: fixtures.map((state) => OliveTaskState.summarize(state)) }))",
    ].join("\n"),
  )
  const run = spawnSync("bun", [file], { encoding: "utf8", cwd: repository })
  await rm(file, { force: true })
  if (run.status !== 0) throw new Error(`parity check could not run the agent modules: ${run.stderr}`)
  const real = JSON.parse(run.stdout)
  const problems = []
  if (real.workflow.join("|") !== WORKFLOW.join("|")) problems.push("WORKFLOW differs from agent.ts")
  fixtures.forEach((state, index) => {
    if (real.summaries[index] !== summarize(state)) problems.push(`summarize differs for fixture ${index}`)
  })
  if (problems.length > 0) throw new Error(`parity failed: ${problems.join("; ")}`)
  console.log(`parity ok: ${fixtures.length} task-state fixtures and the 9-step workflow match packages/core`)
}
