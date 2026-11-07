#!/usr/bin/env bun
/**
 * Runs real Olive agent sessions against the base model hosted on Colab.
 *
 * This is not a `generate()` call: `OliveAgent.run` builds the prompt, validates the requested tool and arguments,
 * executes the tool deterministically, folds the real result into the task state, and decides completion from the
 * executor's own record. Only the model transport is bridged — each model request is uploaded to the live Colab
 * session, rendered with the real LFM2.5 chat template and completed there, then returned as an OpenAI-shaped stream.
 *
 *   OLIVE_COLAB_SESSION=olivellm-eval bun olivellm/scripts/agent-eval.js
 */
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { OliveAgent } from "../../packages/core/src/olive/agent.ts"
import { OliveProvider } from "../../packages/core/src/olive/provider.ts"
import { OliveTaskState } from "../../packages/core/src/olive/task-state.ts"
import { writeJson } from "./lib/json.js"
import { parseGeneration } from "./lib/lfm2-parse.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const session = process.env.OLIVE_COLAB_SESSION ?? "olivellm-eval"
const requestFile = "/tmp/olive-agent-request.json"
// A run id writes into its own directory, so a later measurement never overwrites a published report.
const runId = process.env.OLIVE_RUN
const reports = runId ? path.join(root, "reports/colab/runs", runId) : path.join(root, "reports/colab")
// The same harness measures the base checkpoint and a trained adapter; only the adapter the Colab kernel loads differs.
const adapter = process.env.OLIVE_ADAPTER

const SCENARIOS = [
  {
    id: "inspect-node-project",
    objective: "list the files in this Node.js project and name the entry point",
    seed: {
      "package.json": `${JSON.stringify({ name: "inspect-fixture", private: true, scripts: { start: "node src/server.js" } }, null, 2)}\n`,
      "src/server.js": "const express = require(\"express\")\nconst app = express()\napp.listen(3000)\nmodule.exports = app\n",
    },
    expected: ["project_structure", "list_directory", "read_file"],
  },
  {
    id: "create-node-cli",
    objective: "create src/cli.js that prints hello and a test that checks it",
    // The directory argument made `node --test` itself fail on Node 22, which made the fixture look broken; naming the
    // file keeps the failure about the model's edit rather than about the runner.
    seed: { "package.json": `${JSON.stringify({ name: "cli-scenario", private: true, scripts: { test: "node --test test/cli.test.js" } }, null, 2)}\n` },
    expected: ["write_file"],
  },
  {
    id: "debug-broken-function",
    objective: "the sum test fails, find out why and fix it",
    seed: {
      "package.json": `${JSON.stringify({ name: "debug-scenario", private: true, scripts: { test: "node --test test/sum.test.js" } }, null, 2)}\n`,
      "src/sum.js": "const sum = (left, right) => left - right\n\nmodule.exports = { sum }\n",
      "test/sum.test.js": "const test = require(\"node:test\")\nconst assert = require(\"node:assert\")\nconst { sum } = require(\"../src/sum\")\n\ntest(\"sums\", () => {\n  assert.strictEqual(sum(2, 3), 5)\n})\n",
    },
    expected: ["run_tests", "read_file", "edit_file"],
  },
  {
    id: "find-symbol",
    objective: "where is createUser defined and who calls it?",
    seed: {
      "src/user.js": "function createUser(email) {\n  return { id: \"1\", email }\n}\n\nmodule.exports = { createUser }\n",
      "src/routes.js": "const { createUser } = require(\"./user\")\n\nmodule.exports = (req, res) => res.json(createUser(req.body.email))\n",
    },
    expected: ["search_code", "find_symbols"],
  },
  {
    id: "missing-file",
    objective: "read src/nope.js and fix what is broken in it",
    seed: { "src/app.js": "module.exports = {}\n" },
    expected: ["read_file"],
  },
  {
    id: "resume-partial-project",
    objective: "the previous run only wrote src/index.js; finish the project so its test passes",
    seed: {
      "package.json": `${JSON.stringify({ name: "resume-scenario", private: true, scripts: { test: "node --test test/index.test.js" } }, null, 2)}\n`,
      "src/index.js": "module.exports = { greet: (name) => `hello ${name}` }\n",
    },
    expected: ["read_file", "write_file", "run_tests"],
  },
  {
    id: "answer-from-missing-doc",
    objective: "read docs/setup.md and tell me which command installs the project",
    seed: { "package.json": `${JSON.stringify({ name: "docs-scenario", private: true }, null, 2)}\n` },
    expected: ["read_file"],
  },
  {
    id: "install-then-test",
    objective: "install the dependencies this project declares, then run its tests",
    seed: {
      "package.json": `${JSON.stringify({ name: "install-scenario", private: true, scripts: { test: "node --test test/add.test.js" } }, null, 2)}\n`,
      "src/add.js": "module.exports = { add: (left, right) => left + right }\n",
      "test/add.test.js": "const test = require(\"node:test\")\nconst assert = require(\"node:assert\")\nconst { add } = require(\"../src/add\")\n\ntest(\"adds\", () => {\n  assert.strictEqual(add(2, 3), 5)\n})\n",
    },
    expected: ["install_dependencies", "run_tests"],
  },
  {
    id: "persian-symbol-lookup",
    objective: "تابع createUser کجا تعریف شده و چه کسی آن را صدا می‌زند؟",
    seed: {
      "src/user.js": "function createUser(email) {\n  return { id: \"1\", email }\n}\n\nmodule.exports = { createUser }\n",
      "src/routes.js": "const { createUser } = require(\"./user\")\n\nmodule.exports = (req, res) => res.json(createUser(req.body.email))\n",
    },
    expected: ["search_code", "find_symbols"],
  },
  {
    id: "edit-without-reading",
    objective: "change the error message in src/api.js to \"invalid request\"",
    seed: { "src/api.js": "module.exports = () => ({ error: \"bad request\" })\n" },
    expected: ["read_file", "edit_file"],
  },
]

const generations = []
let current

/** One model request: upload it, generate on the live Colab session, return the text. */
function generate(request) {
  spawnSync("bash", [
    path.join(here, "colab/colab-env.sh"),
    "upload",
    requestFile,
    "/content/request.json",
    "-s",
    session,
  ])
  const result = spawnSync(
    "bash",
    [
      path.join(here, "colab/colab-env.sh"),
      "exec",
      "-s",
      session,
      "-f",
      path.join(here, "colab/generate.py"),
      "--timeout",
      "600",
      ...(adapter ? ["--env", `OLIVE_ADAPTER=${adapter}`] : []),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
  const match = /OLIVE_JSON_BEGIN\n([\s\S]*?)\nOLIVE_JSON_END/.exec(result.stdout ?? "")
  if (!match) throw new Error(`colab generation failed: ${(result.stderr ?? "").slice(-400)}`)
  return JSON.parse(match[1])
}

/** OpenAI-compatible SSE, with the model's native tool-call block converted to `tool_calls` deltas. */
function completion(text) {
  const parsed = parseGeneration(text)
  const chunks = []
  if (text.length > 0) chunks.push({ choices: [{ delta: { content: text } }] })
  parsed.calls.forEach((call, index) =>
    chunks.push({
      choices: [
        {
          delta: {
            tool_calls: [
              { index, id: `call_${index + 1}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } },
            ],
          },
        },
      ],
    }),
  )
  chunks.push({ choices: [{ delta: {}, finish_reason: "stop" }] })
  return `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`
}

await writeFile(requestFile, "{}", "utf8")
const server = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const body = await request.json()
    await writeFile(requestFile, JSON.stringify({ messages: body.messages, tools: body.tools ?? [], max_tokens: 192 }), "utf8")
    const generated = generate(body)
    generations.push({
      scenario: current,
      prompt_tokens: generated.prompt_tokens,
      output_tokens: generated.output_tokens,
      seconds: generated.seconds,
      text: generated.text,
      parsed_calls: parseGeneration(generated.text).calls.map((call) => call.name),
    })
    return new Response(completion(generated.text), { headers: { "content-type": "text/event-stream" } })
  },
})

const provider = OliveProvider.resolveProvider(
  {
    id: "colab",
    type: "openai-compatible",
    baseURL: `http://127.0.0.1:${server.port}/v1`,
    models: [{ id: "lfm2.5-350m", context: 4096, maxOutput: 512, tools: true }],
  },
  {},
)
const registry = { providers: [provider], default: { provider: "colab", model: "lfm2.5-350m" }, sources: [] }

const results = []
for (const [index, scenario] of SCENARIOS.entries()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), `olive-agent-${scenario.id}-`))
  try {
    for (const [file, content] of Object.entries(scenario.seed)) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await writeFile(path.join(directory, file), content, "utf8")
    }
    current = scenario.id
    const before = generations.length
    const outcome = await OliveAgent.run({
      registry,
      directory,
      objective: scenario.objective,
      state: OliveTaskState.store(OliveAgent.stateFile(directory), scenario.objective),
      maxSteps: 4,
    }).catch((cause) => ({ error: cause?.code ?? (cause instanceof Error ? cause.message : String(cause)) }))
    const executed = "task" in outcome ? outcome.task.files : []
    results.push({
      id: scenario.id,
      objective: scenario.objective,
      expected_tools: scenario.expected,
      model_requests: generations.length - before,
      steps: "steps" in outcome ? outcome.steps : 0,
      completed: "completed" in outcome ? outcome.completed : false,
      error: "error" in outcome ? outcome.error : undefined,
      tool_failures: "failures" in outcome ? outcome.failures.length : 0,
      files: executed,
      tool_calls_chosen: generations.slice(before).flatMap((generation) => generation.parsed_calls),
      next: "task" in outcome ? outcome.task.next : undefined,
      response_excerpt: "text" in outcome ? outcome.text.slice(0, 240) : "",
      verified: "task" in outcome ? (outcome.task.verification.length > 0 ? outcome.task.verification : []) : [],
      index,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

server.stop(true)

const report = {
  status: "measured",
  run_id: runId ?? null,
  adapter: adapter ?? null,
  model: "LiquidAI/LFM2.5-350M",
  runtime: "OliveAgent.run with the real OliveTools executor; only the model transport is bridged to Colab",
  scenarios: results.length,
  completed: results.filter((item) => item.completed).length,
  completed_without_verification: results.filter((item) => item.completed && item.verified.length === 0).length,
  scenarios_with_a_tool_call: results.filter((item) => item.tool_calls_chosen.length > 0).length,
  tool_calls_chosen: results.flatMap((item) => item.tool_calls_chosen),
  model_requests: generations.length,
  average_prompt_tokens: Math.round(generations.reduce((total, item) => total + item.prompt_tokens, 0) / Math.max(1, generations.length)),
  average_output_tokens: Math.round(generations.reduce((total, item) => total + item.output_tokens, 0) / Math.max(1, generations.length)),
  results,
  comparison:
    "Direct generation and the agent workflow see the same prompts. The difference is what happens next: the agent cannot report completion without a real, successful tool record, while a direct generation can claim anything.",
}

await mkdir(path.join(reports, "raw"), { recursive: true })
await writeJson(path.join(reports, "agent_workflow_evaluation.json"), report)
await writeJson(path.join(reports, "raw/agent-generations.json"), generations)

console.log("agent scenarios:", report.scenarios, "completed:", report.completed, "tool calls:", report.tool_calls_chosen.length)
for (const item of results) console.log(`- ${item.id}: steps=${item.steps} completed=${item.completed} calls=[${item.tool_calls_chosen.join(",")}] next=${item.next ?? "-"}`)
