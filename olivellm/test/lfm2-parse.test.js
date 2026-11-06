import { expect, test } from "bun:test"
import { parseGeneration } from "../scripts/lib/lfm2-parse.js"

const wrap = (body) => `<|tool_call_start|>[${body}]<|tool_call_end|>`

test("parses the call the checkpoint actually writes, with double quotes", () => {
  const parsed = parseGeneration(wrap('list_directory(path="src")'))
  expect(parsed.invalid).toBe(false)
  expect(parsed.calls).toEqual([{ name: "list_directory", arguments: { path: "src" } }])
})

test("parses the call the chat template renders, with single quotes", () => {
  const parsed = parseGeneration(wrap("list_directory(path='src')"))
  expect(parsed.invalid).toBe(false)
  expect(parsed.calls).toEqual([{ name: "list_directory", arguments: { path: "src" } }])
})

test("unescapes the quote, backslash and newline that opened the literal", () => {
  const single = parseGeneration(wrap("write_file(content='a\\'b\\\\c\\nd')"))
  expect(single.calls[0].arguments.content).toBe("a'b\\c\nd")
  const double = parseGeneration(wrap('write_file(content="a\\"b\\\\c\\nd")'))
  expect(double.calls[0].arguments.content).toBe('a"b\\c\nd')
})

test("keeps pythonic literals and numbers typed", () => {
  const parsed = parseGeneration(wrap("run_shell(command='npm test', timeoutMs=120000, live=True, clean=None)"))
  expect(parsed.calls[0].arguments).toEqual({ command: "npm test", timeoutMs: 120000, live: true, clean: null })
})

test("reports plain text with no call block as text, not as an invalid call", () => {
  expect(parseGeneration("The task requires a plan.")).toEqual({ calls: [], invalid: false, text: true })
})

test("marks a malformed call inside a block as invalid instead of guessing", () => {
  const parsed = parseGeneration(wrap("list_directory src"))
  expect(parsed.calls).toEqual([])
  expect(parsed.invalid).toBe(true)
})
