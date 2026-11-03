import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveTaskState } from "../src/olive/task-state.js"

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "olive-task-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("olive task state", () => {
  test("starts with empty lists and the objective", () => {
    const state = OliveTaskState.create("build a page")
    expect(state.objective).toBe("build a page")
    expect(state.plan).toEqual([])
    expect(state.files).toEqual([])
  })

  test("applies updates and deduplicates discovered files and symbols", () => {
    const first = OliveTaskState.apply(OliveTaskState.create("build a page"), {
      plan: ["scaffold", "implement", "verify"],
      files: ["app.tsx", "app.tsx"],
      symbols: ["App"],
    })
    const second = OliveTaskState.apply(first, { files: ["app.tsx", "index.ts"], symbols: ["App", "main"] })
    expect(second.plan).toEqual(["scaffold", "implement", "verify"])
    expect(second.files).toEqual(["app.tsx", "index.ts"])
    expect(second.symbols).toEqual(["App", "main"])
  })

  test("records a completed step and advances the next action", () => {
    const state = OliveTaskState.apply(OliveTaskState.create("build"), {
      plan: ["scaffold", "implement"],
      remaining: ["scaffold", "implement"],
    })
    const next = OliveTaskState.complete(state, "scaffold")
    expect(next.completed).toEqual(["scaffold"])
    expect(next.remaining).toEqual(["implement"])
    expect(next.next).toBe("implement")
  })

  test("round-trips through the stored encoding", () => {
    const state = OliveTaskState.apply(OliveTaskState.create("ship it"), { files: ["a.ts"], next: "run tests" })
    const decoded = OliveTaskState.decodeState(JSON.parse(OliveTaskState.encode(state)))
    expect(decoded).toMatchObject({ objective: "ship it", files: ["a.ts"], next: "run tests" })
    expect(OliveTaskState.decodeState({ objective: 1 })).toBeUndefined()
  })

  test("persists across a restart and continues the task", async () => {
    await withDirectory(async (directory) => {
      const file = path.join(directory, "state", "task.json")
      const store = OliveTaskState.store(file, "add tests")
      expect(await store.read()).toBeUndefined()
      await store.update({ plan: ["write test"], remaining: ["write test"], files: ["a.test.ts"] })
      await store.complete("write test")

      // A new process reads the same durable state instead of the conversation.
      const restarted = OliveTaskState.store(file, "add tests")
      const resumed = await restarted.read()
      expect(resumed?.objective).toBe("add tests")
      expect(resumed?.completed).toEqual(["write test"])
      expect(resumed?.files).toEqual(["a.test.ts"])
      expect(await Bun.file(file).text()).toContain('"objective": "add tests"')
    })
  })

  test("renders a compact summary for the task section", () => {
    const state = OliveTaskState.apply(OliveTaskState.create("fix login"), {
      plan: ["read code"],
      remaining: ["read code"],
      next: "read code",
      errors: ["TypeError"],
    })
    const summary = OliveTaskState.summarize(state)
    expect(summary).toContain("Objective: fix login")
    expect(summary).toContain("Next: read code")
    expect(summary).toContain("Errors: TypeError")
  })
})
