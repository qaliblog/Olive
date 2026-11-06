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

  test("renders a tool call and its result with the ids the endpoint pairs on", () => {
    const plan = OliveContextBudget.plan({ context: 4096, maxOutput: 256 })
    const built = OlivePrompt.build({
      plan,
      task: task(),
      conversation: [
        { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "write_file", arguments: "{}" }] },
        { role: "tool", content: "write_file ok", toolCallId: "call_1" },
      ],
    })
    const assistant = built.messages.find((message) => message.toolCalls?.length)
    expect(assistant?.role).toBe("assistant")
    expect(assistant?.toolCalls?.[0]?.id).toBe("call_1")
    expect(built.messages.find((message) => message.role === "tool")?.toolCallId).toBe("call_1")
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

describe("olive step instruction", () => {
  test("always ends the step message with the operative instruction", () => {
    const plan = OliveContextBudget.plan({ context: 4096, maxOutput: 256 })
    const built = OlivePrompt.build({ plan, task: task() })
    const step = built.messages.at(-1)?.content ?? ""
    expect(step.endsWith(OlivePrompt.instruction("write files"))).toBe(true)
    expect(step).toMatch(/Call one tool now for "write files"\./)
    // The last line decides the reply on this model: with the call sentence trailing, 10 of 65 frozen cases emitted a
    // call; with the same sentence leading, 0 did.
    expect(step.split("\n").at(-1)).toBe('Call one tool now for "write files". Reply with the tool call only.')
  })

  test("keeps the instruction when the body is truncated to nothing", () => {
    const plan = OliveContextBudget.plan({ context: 1024, maxOutput: 900 })
    const built = OlivePrompt.build({
      plan,
      task: task(),
      code: [{ id: "big", kind: "file", text: "const value = 1\n".repeat(4_000) }],
      toolResults: ["output\n".repeat(2_000)],
    })
    const step = built.messages.at(-1)?.content ?? ""
    expect(step.endsWith(OlivePrompt.instruction("write files"))).toBe(true)
    expect(step).toContain("Never describe a tool result you did not receive.")
    expect(step).toContain("(truncated)")
  })

  test("names each stop form so a stop can be told from a failure", () => {
    const instruction = OlivePrompt.instruction()
    expect(instruction).toContain("DONE")
    expect(instruction).toContain("BLOCKED:")
    expect(instruction).toContain("QUESTION:")
    expect(instruction).toContain("Call one tool now for the next step.")
  })
})

describe("adaptive context tiers", () => {
  const plans = [2000, 5000, 10000, 20000].map((context) =>
    OliveContextBudget.plan({ context, maxOutput: Math.floor(context / 10) }),
  )

  test("picks the tier from usable prompt tokens, not the declared window", () => {
    expect(plans.map((plan) => plan.tier)).toEqual(["under4k", "4k_to_8k", "8k_to_16k", "over16k"])
  })

  test("spends the whole prompt budget in every tier", () => {
    for (const plan of plans)
      expect(OliveContextBudget.Section.reduce((sum, section) => sum + plan.sections[section], 0)).toBe(plan.prompt)
  })

  test("gives the extra window to code and history instead of scaling every section", () => {
    const [small, , , large] = plans
    expect(large!.sections.conversation).toBeGreaterThan(small!.sections.conversation * 10)
    // The task section stays large enough to be readable at the smallest tier; it is not the section that shrinks.
    expect(small!.sections.task / small!.prompt).toBeGreaterThan(large!.sections.task / large!.prompt)
  })

  test("caps how much each tier may retain", () => {
    expect(plans.map((plan) => plan.limits.toolResults)).toEqual([2, 4, 6, 10])
    expect(plans.map((plan) => plan.limits.conversation)).toEqual([4, 6, 14, 30])
    expect(plans.map((plan) => plan.limits.code)).toEqual([4, 8, 14, 24])
  })

  test("trims items to the tier limit before the budget", () => {
    const plan = OliveContextBudget.plan({ context: 2000, maxOutput: 200 })
    const built = OlivePrompt.build({
      plan,
      task: task(),
      code: Array.from({ length: 12 }, (_, index) => ({ id: `c${index}`, kind: "snippet" as const, text: `snippet ${index}` })),
      toolResults: Array.from({ length: 12 }, (_, index) => `result ${index}`),
      conversation: Array.from({ length: 12 }, (_, index) => ({ role: "assistant", content: `message ${index}` })),
    })
    const step = built.messages.at(-1)?.content ?? ""
    expect(built.dropped.length).toBeGreaterThan(0)
    expect(step).toContain("result 11")
    expect(step).not.toContain("result 0")
    expect(built.messages.filter((message) => message.role !== "system" && message.role !== "user")).toHaveLength(4)
  })

  test("an explicit allocation still overrides the tier policy", () => {
    const plan = OliveContextBudget.plan({ context: 8192, maxOutput: 512, allocation: { code: 0.2, conversation: 0.1 } })
    expect(plan.sections.code).toBeLessThan(OliveContextBudget.plan({ context: 8192, maxOutput: 512 }).sections.code)
  })
})
