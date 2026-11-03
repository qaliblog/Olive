import { expect, test } from "bun:test"
import { ServerAuth } from "@olive/server/auth"
import { Option, Redacted } from "effect"

test("accepts only the fixed olive username and the exact password", () => {
  const config = { password: Option.some("secret"), username: "olive" }
  expect(ServerAuth.authorized({ username: "olive", password: Redacted.make("secret") }, config)).toBe(true)
  expect(ServerAuth.authorized({ username: "custom", password: Redacted.make("secret") }, config)).toBe(false)
  expect(ServerAuth.authorized({ username: "olive", password: Redacted.make("wrong") }, config)).toBe(false)
  expect(ServerAuth.authorized({ username: "olive", password: Redacted.make("secret") }, { ...config, password: Option.none() })).toBe(false)
})
