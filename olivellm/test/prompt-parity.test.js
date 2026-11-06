import { expect, test } from "bun:test"
import { OliveContextBudget } from "../../packages/core/src/olive/context-budget.ts"
import { OlivePrompt } from "../../packages/core/src/olive/prompt.ts"
import { buildStep, instruction, SYSTEM } from "../scripts/lib/prompt.js"
import { initialize } from "../scripts/lib/state.js"

const task = () => initialize("fix the login button in src/App.tsx")
const code = [{ id: "src/App.tsx:App", kind: "symbol", file: "src/App.tsx", text: "export function App() {}" }]
const toolResults = ["read_file ok\nexport function App() {}"]

test("the dataset prompt is the runtime prompt, instruction included", () => {
  const built = OlivePrompt.build({
    plan: OliveContextBudget.plan({ context: 8192, maxOutput: 512 }),
    task: task(),
    code,
    toolResults,
  })
  expect(built.messages.at(-1)?.content).toBe(buildStep({ task: task(), code, toolResults }))
})

test("both prompts carry the same operative instruction for the same next action", () => {
  expect(instruction(task().next)).toBe(OlivePrompt.instruction(task().next))
  expect(instruction(task().next)).toContain("Call one tool now")
  expect(buildStep({ task: task(), code, toolResults })).toContain(OlivePrompt.instruction(task().next))
})

test("the copied system prompt still matches the runtime one", () => {
  expect(SYSTEM).toBe(OlivePrompt.SYSTEM)
})

test("every exported training record ends with the instruction, so the target is never a bare state block", () => {
  // The exporter renders the assistant target after the user turn; the user turn must still end with the instruction,
  // otherwise a fine-tuned model is trained on the exact prompt shape that produces zero tool calls.
  const step = buildStep({ task: task(), code, toolResults })
  expect(step.endsWith(OlivePrompt.instruction(task().next))).toBe(true)
  expect(step.startsWith("Task state:")).toBe(true)
})
