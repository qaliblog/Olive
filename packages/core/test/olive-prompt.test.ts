import { describe, expect, test } from "bun:test"
import { OliveContextBudget } from "../src/olive/context-budget.js"
import { OlivePrompt } from "../src/olive/prompt.js"
import { OliveTaskState } from "../src/olive/task-state.js"

const task = () =>
  OliveTaskState.apply(OliveTaskState.create("Fix the login button in src/App.tsx"), {
    files: ["src/App.tsx"],
    plan: ["analyze requirements", "write files"],
    completed: ["analyze requirements"],
    remaining: ["write files"],
    next: "write files",
  })

describe("olive prompt", () => {
  test("fits every section inside the declared model window", () => {
    const plan = OliveContextBudget.plan({ context: 2048, maxOutput: 256 })
    const code: OliveContextBudget.Item[] = Array.from({ length: 20 }, (_, index) => ({
      id: `snippet-${index}`,
      kind: "snippet",
      file: `src/file-${index}.ts`,
      priority: index,
      text: `export function handler${index}() {\n${"  const value = 1\n".repeat(20)}}`,
    }))
    const conversation: OliveContextBudget.ConversationMessage[] = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message ${index} ${"detail ".repeat(60)}`,
    }))
    const toolResults = Array.from({ length: 20 }, (_, index) => `tool ${index}\n${"output line\n".repeat(40)}`)
    const built = OlivePrompt.build({ plan, task: task(), code, conversation, toolResults })
    expect(OlivePrompt.tokens(built)).toBeLessThanOrEqual(plan.prompt)
    expect(built.dropped.length).toBeGreaterThan(0)
    expect(built.messages[0]?.content).toContain("You are Olive")
    expect(built.messages.some((message) => message.content.includes("compacted"))).toBe(true)
  })

  test("prefers a symbol over a whole-file item for the same file", () => {
    const plan = OliveContextBudget.plan({ context: 4096, maxOutput: 256 })
    const built = OlivePrompt.build({
      plan,
      task: task(),
      code: [
        { id: "symbol", kind: "symbol", file: "src/App.tsx", priority: 10, text: "export function App() {}" },
        { id: "file", kind: "file", file: "src/App.tsx", priority: 1, text: "whole file contents" },
      ],
    })
    const step = built.messages.at(-1)?.content ?? ""
    expect(step).toContain("export function App")
    expect(step).not.toContain("whole file contents")
  })

  test("keeps the newest tool results when the budget is small", () => {
    const kept = OlivePrompt.compressResults(["old ".repeat(100), "newest result"], 20)
    expect(kept.at(-1)).toContain("newest result")
  })

  test("never exceeds a tiny allocation", () => {
    const plan = OliveContextBudget.plan({ context: 1024, maxOutput: 1024 })
    const built = OlivePrompt.build({
      plan,
      task: task(),
      code: [{ id: "x", kind: "file", text: "line\n".repeat(2_000) }],
    })
    expect(OlivePrompt.tokens(built)).toBeLessThanOrEqual(plan.prompt)
  })
})
