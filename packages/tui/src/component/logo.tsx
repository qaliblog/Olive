import { TextAttributes } from "@opentui/core"
import { For, Show } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { logo, width } from "../logo"

// The wordmark needs its columns plus the padding Home and Stats put beside it. Below that, the lowercase
// lockup stays legible where a squeezed block wordmark would touch the edges.
const compact = "olive"

export function Logo() {
  const theme = useTheme()
  const dimensions = useTerminalDimensions()
  // Home pads by two columns on wide terminals and one below 44, and the logo shrinks with it.
  const padding = () => (dimensions().width < 44 ? 1 : 2)

  return (
    <Show when={dimensions().height >= 12}>
      <box>
        <Show
          when={dimensions().width - padding() * 2 >= width(logo)}
          fallback={
            <text fg={theme.text.base} attributes={TextAttributes.BOLD} selectable={false}>
              {compact}
            </text>
          }
        >
          <For each={logo.rows}>
            {(row) => (
              <text fg={theme.text.base} selectable={false}>
                {row.trimEnd()}
              </text>
            )}
          </For>
        </Show>
      </box>
    </Show>
  )
}
