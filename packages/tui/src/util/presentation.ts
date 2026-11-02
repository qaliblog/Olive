import { logo } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
// Olive green, the same accent the wordmark carries elsewhere. One escape per row means no per-cell
// styling can shift a column or leave an unterminated background behind.
const olive = "\x1b[38;5;107m"

function wordmark(pad = "") {
  const color = process.env.NO_COLOR === undefined
  return logo.rows.map((row) => `${pad}${color ? olive : ""}${row.trimEnd()}${color ? reset : ""}`)
}

export type SessionEpilogue = { readonly title: string; readonly sessionID?: string }

// Printed after the TUI closes.
export function epilogue(input: { readonly session?: SessionEpilogue; readonly updatedVersion?: string }) {
  if (!input.session && !input.updatedVersion) return
  const row = (label: string, value: string) => `  ${dim}${label.padEnd(10, " ")}${reset}${bold}${value}${reset}`
  return [
    ...wordmark("  "),
    "",
    ...(input.updatedVersion
      ? [`  ${dim}Run ${reset}${bold}olive${reset}${dim} to use ${reset}${bold}${input.updatedVersion}${reset}`, ""]
      : []),
    ...(input.session
      ? [row("Session", input.session.title), row("Continue", `olive -s ${input.session.sessionID}`), ""]
      : []),
  ].join("\n")
}
