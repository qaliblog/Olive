import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Guards the invariant the trainer's supervisor mask depends on: `target` is the assistant content immediately before
 * the closing `<|im_end|>`, and `text` contains it exactly once at the end of the final assistant turn.
 *
 * This is the test that catches the export defect where `assistantTarget` was handed the message object instead of its
 * `content`, so every tool-call target began with the literal string "undefined" and no record's mask could align.
 */
const root = path.resolve(import.meta.dir, "..")

async function records(split) {
  const text = await readFile(path.join(root, `datasets/processed/sft-${split}.jsonl`), "utf8")
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))
}

const train = await records("train")
const validation = await records("validation")

function check(record) {
  expect(typeof record.target).toBe("string")
  expect(record.target.trim().length).toBeGreaterThan(0)
  expect(record.target).not.toStartWith("undefined")
  expect(record.text.endsWith("<|im_end|>\n")).toBe(true)

  const index = record.text.lastIndexOf(record.target)
  expect(index).toBeGreaterThan(-1)
  expect(record.text.slice(index + record.target.length)).toBe("<|im_end|>\n")
  expect(record.text.slice(0, index).endsWith("<|im_start|>assistant\n")).toBe(true)
}

describe("supervised targets in the exported SFT splits", () => {
  test("every training target is the final assistant turn", () => {
    for (const record of train) check(record)
  })

  test("every validation target is the final assistant turn", () => {
    for (const record of validation) check(record)
  })

  test("targets cover native tool calls, assistant text and both languages", () => {
    const toolCalls = train.filter((record) => record.target.includes("<|tool_call_start|>"))
    const textOnly = train.filter((record) => !record.target.includes("<|tool_call_start|>"))
    expect(toolCalls.length).toBeGreaterThan(200)
    expect(textOnly.length).toBeGreaterThan(10)
    expect(train.some((record) => record.language === "fa")).toBe(true)
    expect(train.some((record) => record.language === "mixed")).toBe(true)
  })

  test("a text-only target equals the assistant message content", () => {
    const record = train.find((item) => !item.target.includes("<|tool_call_start|>"))
    const assistant = record.messages.at(-1)
    expect(assistant.role).toBe("assistant")
    expect(record.target).toBe(assistant.content)
  })

  test("a tool-call target renders the call the message declares", () => {
    const record = train.find((item) => item.target.includes("<|tool_call_start|>"))
    const [call] = record.messages.at(-1).toolCalls
    expect(record.target).toContain(`[${call.name}(`)
    expect(record.target).not.toContain("undefined")
  })
})
