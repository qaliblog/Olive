export * as OlivePrompt from "./prompt.js"

import { OliveContextBudget } from "./context-budget.js"
import { OliveProvider } from "./provider.js"
import { OliveTaskState } from "./task-state.js"

/**
 * Prompt construction for a small model. It never sends a whole project, a whole file, or the full conversation: every
 * section is fitted to the token budget derived from the configured model's real context window, and precision wins
 * over volume (symbols and snippets before files, summaries before transcripts).
 */
export const SYSTEM = [
  "You are Olive, a local coding agent. Work in small steps and use tools.",
  "Rules:",
  "- Inspect before editing: read or search before you change a file.",
  "- Write files incrementally, one file per write_file call. Do not batch a project into one call.",
  "- After writing, run diagnostics or tests and fix what fails.",
  "- Never claim a tool succeeded unless its result says ok. Report the error instead.",
  "- Reply with one short next action.",
  "Tools: read_file write_file edit_file list_directory search_code find_symbols run_shell run_tests install_dependencies inspect_diagnostics project_structure",
].join("\n")

/** Cuts text to a token budget without slicing through the middle of a line. */
export function truncate(text: string, tokens: number) {
  if (tokens <= 0) return ""
  const marker = "\n… (truncated)"
  const limit = Math.max(1, tokens) * 4
  if (text.length <= limit) return text
  const room = Math.max(0, limit - marker.length)
  const cut = text.lastIndexOf("\n", room)
  const end = cut > room / 2 ? cut : room
  return `${text.slice(0, end).trimEnd()}${marker}`
}

/** Keeps the newest tool results that fit, each already compressed to a short excerpt. */
export function compressResults(results: readonly string[], budget: number) {
  const kept: string[] = []
  let tokens = 0
  for (const result of [...results].reverse()) {
    const text = truncate(result, Math.min(160, budget))
    const cost = OliveContextBudget.estimateTokens(text)
    if (tokens + cost > budget) break
    kept.unshift(text)
    tokens += cost
  }
  return kept
}

export interface Input {
  readonly plan: OliveContextBudget.Plan
  readonly task: OliveTaskState.TaskState
  readonly code?: readonly OliveContextBudget.Item[]
  readonly conversation?: readonly OliveContextBudget.ConversationMessage[]
  readonly toolResults?: readonly string[]
}

export interface Built {
  readonly messages: readonly OliveProvider.ChatMessage[]
  readonly dropped: readonly OliveContextBudget.Item[]
}

export function build(input: Input): Built {
  const { plan } = input
  const code = OliveContextBudget.fit(input.code ?? [], plan.sections.code)
  const conversation = OliveContextBudget.compactConversation(input.conversation ?? [], plan.sections.conversation)
  const system = truncate(SYSTEM, plan.sections.system)
  const step = [
    "Task state:",
    truncate(OliveTaskState.summarize(input.task), plan.sections.task),
    "",
    "Relevant code:",
    truncate(code.kept.map((item) => item.text).join("\n\n"), plan.sections.code) || "(none yet)",
    "",
    "Recent tool results:",
    compressResults(input.toolResults ?? [], plan.sections.toolResults).join("\n") || "(none yet)",
  ].join("\n")
  return {
    messages: [
      { role: "system", content: system },
      ...(conversation.summary
        ? [{ role: "system" as const, content: truncate(conversation.summary, plan.sections.conversation) }]
        : []),
      ...conversation.kept.map((message): OliveProvider.ChatMessage => {
        const role = message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user"
        return { role, content: message.content }
      }),
      {
        role: "user",
        content: truncate(step, plan.sections.task + plan.sections.code + plan.sections.toolResults),
      },
    ],
    dropped: code.dropped,
  }
}

/** Total prompt cost of a built conversation, in the same heuristic unit the budget uses. */
export function tokens(built: { readonly messages: readonly OliveProvider.ChatMessage[] }) {
  return built.messages.reduce((sum, message) => sum + OliveContextBudget.estimateTokens(message.content), 0)
}
