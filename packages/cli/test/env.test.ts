import { expect, test } from "bun:test"
import { Env } from "../src/env"

test("session environment omits server credentials", () => {
  const previousPassword = process.env.OLIVE_PASSWORD
  const previousLegacyPassword = process.env.OLIVE_SERVER_PASSWORD
  const previousValue = process.env.OLIVE_SESSION_ENV_TEST
  process.env.OLIVE_PASSWORD = "password"
  process.env.OLIVE_SERVER_PASSWORD = "legacy"
  process.env.OLIVE_SESSION_ENV_TEST = "included"

  const environment = Env.session()

  if (previousPassword === undefined) delete process.env.OLIVE_PASSWORD
  else process.env.OLIVE_PASSWORD = previousPassword
  if (previousLegacyPassword === undefined) delete process.env.OLIVE_SERVER_PASSWORD
  else process.env.OLIVE_SERVER_PASSWORD = previousLegacyPassword
  if (previousValue === undefined) delete process.env.OLIVE_SESSION_ENV_TEST
  else process.env.OLIVE_SESSION_ENV_TEST = previousValue

  expect(environment.OLIVE_PASSWORD).toBeUndefined()
  expect(environment.OLIVE_SERVER_PASSWORD).toBeUndefined()
  expect(environment.OLIVE_SESSION_ENV_TEST).toBe("included")
})
