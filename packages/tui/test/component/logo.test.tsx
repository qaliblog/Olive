/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { Logo } from "../../src/component/logo"
import { ConfigProvider } from "../../src/config"
import { ThemeProvider } from "../../src/context/theme"
import { logo } from "../../src/logo"
import { emptyThemeSource } from "../fixture/fixture"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

async function renderLogo(width: number, height = 24) {
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig()}>
        <ThemeProvider mode="dark" source={emptyThemeSource}>
          <Logo />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width, height },
  )
  try {
    await app.renderOnce()
    return { frame: app.captureCharFrame(), spans: app.captureSpans().lines.flatMap((line) => line.spans) }
  } finally {
    app.renderer.destroy()
  }
}

test("draws the full wordmark on a wide terminal", async () => {
  const { frame, spans } = await renderLogo(80)
  const rows = logo.rows.map((row) => row.trimEnd())

  for (const row of rows) expect(frame).toContain(row)
  // Each row is one run, so nothing inside a letter can shift its columns or restyle a stroke.
  const runs = spans.filter((span) => rows.includes(span.text))
  expect(runs.map((run) => run.text)).toEqual(rows)
  expect(new Set(runs.map((run) => run.fg.toInts().join(","))).size).toBe(1)
  expect(frame).not.toMatch(/[_^~]/)
})

test("falls back to the compact lockup when the columns are too narrow", async () => {
  const { frame } = await renderLogo(20)
  expect(frame).toContain("olive")
  expect(frame).not.toContain("█")
})

test("stays out of the way on a short terminal", async () => {
  const { frame } = await renderLogo(80, 10)
  expect(frame).not.toContain("olive")
  expect(frame).not.toContain("█")
})
