import { describe, expect, test } from "bun:test"
import { OliveContextBudget } from "../src/olive/context-budget.js"

describe("olive context budget", () => {
  test("default allocations cover the whole window", () => {
    const total = Object.values(OliveContextBudget.DEFAULT_ALLOCATION).reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1)
  })

  test("reserves generation capacity from the real context and caps it at maxOutput", () => {
    const allocated = OliveContextBudget.plan({ context: 8192, maxOutput: 512 })
    expect(allocated.generation).toBe(512)
    expect(allocated.prompt).toBe(8192 - 512)
    const sections = Object.values(allocated.sections).reduce((sum, value) => sum + value, 0)
    expect(sections).toBe(allocated.prompt)
    expect(allocated.sections.code).toBeGreaterThan(allocated.sections.system)
  })

  test("never assumes a large window: a small context keeps every section usable", () => {
    const allocated = OliveContextBudget.plan({ context: 2048, maxOutput: 4096 })
    expect(allocated.generation).toBe(204)
    expect(allocated.prompt).toBe(2048 - 204)
    for (const value of Object.values(allocated.sections)) expect(value).toBeGreaterThan(100)
  })

  test("honours a custom allocation", () => {
    const allocated = OliveContextBudget.plan({
      context: 4000,
      maxOutput: 100,
      allocation: { system: 0.5, task: 0.1, code: 0.2, conversation: 0.05, toolResults: 0.05, generation: 0.1 },
    })
    expect(allocated.generation).toBe(100)
    expect(allocated.sections.system).toBeGreaterThan(allocated.sections.code)
  })

  test("prefers symbol context over whole files", () => {
    const items: OliveContextBudget.Item[] = [
      { id: "file", text: "whole file", kind: "file", file: "a.ts" },
      { id: "symbol", text: "function a() {}", kind: "symbol", file: "a.ts" },
      { id: "other", text: "whole file", kind: "file", file: "b.ts" },
    ]
    expect(OliveContextBudget.preferSymbols(items).map((item) => item.id)).toEqual(["symbol", "other"])
  })

  test("evicts the lowest priority items when the budget is full", () => {
    const items: OliveContextBudget.Item[] = [
      { id: "low", text: "x".repeat(40), priority: 0 },
      { id: "high", text: "y".repeat(40), priority: 5 },
      { id: "mid", text: "z".repeat(40), priority: 1 },
    ]
    const fitted = OliveContextBudget.fit(items, 20)
    expect(fitted.kept.map((item) => item.id)).toEqual(["high", "mid"])
    expect(fitted.dropped.map((item) => item.id)).toEqual(["low"])
    expect(fitted.tokens).toBe(20)
  })

  test("keeps the newest conversation and summarizes the rest", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({ role: "user", content: "m".repeat(40) }))
    const compacted = OliveContextBudget.compactConversation(messages, 30)
    expect(compacted.kept).toHaveLength(3)
    expect(compacted.summary).toContain("7 message(s)")
    expect(compacted.tokens).toBeGreaterThan(30)
  })

  test("never keeps a tool result without the assistant call that produced it", () => {
    const messages: OliveContextBudget.ConversationMessage[] = [
      { role: "user", content: "build the page" },
      { role: "assistant", content: "thinking ".repeat(20), toolCalls: [{ id: "call_1", name: "write_file", arguments: "{}" }] },
      { role: "tool", content: "write_file ok", toolCallId: "call_1" },
    ]
    const compacted = OliveContextBudget.compactConversation(messages, 10)
    expect(compacted.kept).toEqual([])
    expect(compacted.summary).toContain("3 message(s)")
  })

  test("keeps a full call and result pair when both fit", () => {
    const messages: OliveContextBudget.ConversationMessage[] = [
      {
        role: "assistant",
        content: "writing",
        toolCalls: [
          { id: "call_1", name: "write_file", arguments: "{}" },
          { id: "call_2", name: "edit_file", arguments: "{}" },
        ],
      },
      { role: "tool", content: "write_file ok", toolCallId: "call_2" },
    ]
    const compacted = OliveContextBudget.compactConversation(messages, 100)
    expect(compacted.kept.map((message) => message.toolCallId ?? message.role)).toEqual(["assistant", "call_2"])
    expect(compacted.kept[0]?.toolCalls?.map((call) => call.id)).toEqual(["call_2"])
  })

  test("estimates tokens from text length instead of claiming a tokenizer", () => {
    expect(OliveContextBudget.estimateTokens("")).toBe(0)
    expect(OliveContextBudget.estimateTokens("abcd")).toBe(1)
    expect(OliveContextBudget.estimateTokens("a".repeat(401))).toBe(101)
  })

  test("counts non-Latin script higher than Latin text of the same length", () => {
    const persian = "یک برنامه ریاکت بساز"
    expect(persian.length).toBe(20)
    expect(OliveContextBudget.estimateTokens(persian)).toBeGreaterThan(OliveContextBudget.estimateTokens("a".repeat(20)))
    expect(OliveContextBudget.estimateTokens("a".repeat(20))).toBe(5)
  })
})
