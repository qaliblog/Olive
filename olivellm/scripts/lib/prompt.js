import { summarize } from "./state.js"

/** Verbatim copy of OlivePrompt.SYSTEM in packages/core/src/olive/prompt.ts. */
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

/**
 * `OlivePrompt.build` without budget truncation. Examples are capped at 2048 estimated tokens by the validator, which
 * is below the point where the budget would start dropping sections, so the rendered step message is the whole
 * prompt rather than a truncated one.
 */
export function buildStep({ task, code = [], toolResults = [] }) {
  return [
    "Task state:",
    summarize(task),
    "",
    "Relevant code:",
    code.map((item) => item.text).join("\n\n") || "(none yet)",
    "",
    "Recent tool results:",
    [...toolResults].reverse().join("\n") || "(none yet)",
  ].join("\n")
}

/** The conversation Olive sends before the step message: kept history plus an optional compaction summary. */
export function buildMessages({ task, code = [], toolResults = [], conversation = [], summary }) {
  return [
    { role: "system", content: SYSTEM },
    ...(summary ? [{ role: "system", content: summary }] : []),
    ...conversation,
    { role: "user", content: buildStep({ task, code, toolResults }) },
  ]
}
