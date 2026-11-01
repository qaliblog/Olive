import { expect, test } from "bun:test"
import { selectTheme, selectThemeMode, supportsThemeMode, themeModes } from "@olive/theme/tui"
import { getOliveTheme } from "../../../src/theme"

test("selects complete light and dark themes independently", () => {
  const light = selectTheme(getOliveTheme(), "light")
  const dark = selectTheme(getOliveTheme(), "dark")
  expect(selectTheme(getOliveTheme())).toEqual(light)
  expect(light.hue).toEqual(getOliveTheme().light.hue)
  expect(dark.text).toEqual(getOliveTheme().base.text)
  expect(dark.hue).toEqual(getOliveTheme().dark.hue)
  expect(selectThemeMode(getOliveTheme(), "dark")).toEqual({ theme: dark, mode: "dark" })
})

test("selects the available mode when the requested mode is missing", () => {
  const lightOnly = { base: getOliveTheme().base, light: getOliveTheme().light } as const
  const darkOnly = { base: getOliveTheme().base, dark: getOliveTheme().dark } as const

  expect(themeModes(lightOnly)).toEqual(["light"])
  expect(themeModes(darkOnly)).toEqual(["dark"])
  expect(supportsThemeMode(lightOnly, "light")).toBeTrue()
  expect(supportsThemeMode(lightOnly, "dark")).toBeFalse()
  expect(selectThemeMode(lightOnly, "dark")).toEqual({ theme: selectTheme(getOliveTheme(), "light"), mode: "light" })
  expect(selectThemeMode(darkOnly, "light")).toEqual({ theme: selectTheme(getOliveTheme(), "dark"), mode: "dark" })
})
