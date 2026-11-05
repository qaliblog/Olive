import { beforeAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Tests the real validator, not a copy of its rules: each case writes a fixture and runs
 * `node olivellm/scripts/validate.js` against it, then asserts the exit code and the rejection reasons.
 */
const root = path.resolve(import.meta.dir, "..")
const script = path.join(root, "scripts/validate.js")
let directory
let valid

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "olivellm-validate-test-"))
  const corpus = await readFile(path.join(root, "datasets/raw/examples.jsonl"), "utf8")
  valid = JSON.parse(corpus.split("\n").find((line) => line.trim().length > 0))
})

async function run({ lines, input }) {
  const file = input ?? path.join(directory, `input-${Math.random().toString(16).slice(2)}.jsonl`)
  if (lines) await writeFile(file, `${lines.join("\n")}\n`, "utf8")
  const output = path.join(directory, `validated-${Math.random().toString(16).slice(2)}.jsonl`)
  const rejected = path.join(directory, `rejected-${Math.random().toString(16).slice(2)}.jsonl`)
  const result = spawnSync("node", [script, "--input", file, "--output", output, "--rejected", rejected], {
    encoding: "utf8",
    cwd: root,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output, rejected }
}

describe("dataset validator exit codes", () => {
  test("accepts a valid example and exits 0", async () => {
    const result = await run({ lines: [JSON.stringify(valid)] })
    expect(result.stdout).toContain("validated 1/1 examples, rejected 0")
    expect(result.status).toBe(0)
    expect((await readFile(result.output, "utf8")).trim().split("\n")).toHaveLength(1)
  })

  test("rejects invalid JSON and exits nonzero", async () => {
    const result = await run({ lines: ["{ this is not json"] })
    expect(result.status).not.toBe(0)
  })

  test("rejects a schema violation and exits nonzero", async () => {
    const result = await run({ lines: [JSON.stringify({ ...valid, category: "not_a_category" })] })
    expect(result.status).toBe(1)
    const rejected = (await readFile(result.rejected, "utf8")).trim()
    expect(rejected).toContain("schema")
  })

  test("rejects a missing required field and exits nonzero", async () => {
    const broken = { ...valid }
    delete broken.objective
    const result = await run({ lines: [JSON.stringify(broken)] })
    expect(result.status).toBe(1)
    const rejected = await readFile(result.rejected, "utf8")
    expect(rejected).toContain("$.")
    expect(rejected).toContain("objective")
  })

  test("rejects an unknown tool call and exits nonzero", async () => {
    const broken = {
      ...valid,
      expected_tool_calls: [{ ...valid.expected_tool_calls[0], name: "delete_everything" }],
      expected_tool_results: [],
    }
    const result = await run({ lines: [JSON.stringify(broken)] })
    expect(result.status).toBe(1)
    expect((await readFile(result.rejected, "utf8")).trim()).toContain("delete_everything")
  })

  test("rejects an impossible task-state transition and exits nonzero", async () => {
    const broken = {
      ...valid,
      expected_task_state: { ...valid.expected_task_state, completed: ["verify the result"], remaining: ["analyze requirements"] },
    }
    const result = await run({ lines: [JSON.stringify(broken)] })
    expect(result.status).toBe(1)
    expect((await readFile(result.rejected, "utf8")).trim()).toContain("task state")
  })

  test("rejects a completion claim after a file change without tests and exits nonzero", async () => {
    const changed = JSON.parse(JSON.stringify(valid))
    changed.expected_response = { kind: "tool_call", text: "The page is done and verified.", completion: "done" }
    changed.expected_task_state.verification = []
    const result = await run({ lines: [JSON.stringify(changed)] })
    expect(result.status).toBe(1)
    expect((await readFile(result.rejected, "utf8")).trim()).toContain("completion done")
  })

  test("fails when the pipeline cannot read its input", async () => {
    const result = await run({ input: path.join(directory, "does-not-exist.jsonl") })
    expect(result.status).not.toBe(0)
  })

  test("fails loudly on an unknown flag instead of ignoring it", async () => {
    const file = path.join(directory, "one.jsonl")
    await writeFile(file, `${JSON.stringify(valid)}\n`, "utf8")
    const result = spawnSync("node", [script, "--input", file, "--typo"], { encoding: "utf8", cwd: root })
    expect(result.status).not.toBe(0)
  })
})
