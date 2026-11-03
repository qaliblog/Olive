import { expect, test } from "bun:test"
import { isAllowedRequestOrigin } from "../src/cors"

test("PTY origin checks allow same-host and loopback origins only", () => {
  expect(isAllowedRequestOrigin(undefined, "192.168.1.10:1029")).toBe(true)
  expect(isAllowedRequestOrigin("http://192.168.1.10:1029", "192.168.1.10:1029")).toBe(true)
  expect(isAllowedRequestOrigin("http://localhost:3001", "192.168.1.10:1029")).toBe(true)
  expect(isAllowedRequestOrigin("http://127.0.0.1:3001", "192.168.1.10:1029")).toBe(true)
  expect(isAllowedRequestOrigin("http://192.168.1.10:3001", "192.168.1.10:1029")).toBe(false)
  expect(isAllowedRequestOrigin("https://example.com", "192.168.1.10:1029")).toBe(false)
  expect(isAllowedRequestOrigin("null", "192.168.1.10:1029")).toBe(false)
})
