import { describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import { Updater } from "./updater"

const program = Effect.gen(function* () {
  const updater = yield* Updater.Service
  const run = yield* updater.run()
  const check = yield* updater.check()
  const method = yield* updater.method()
  const apply = yield* updater.apply("9.9.9").pipe(Effect.result)
  const latest = yield* updater.latest().pipe(Effect.result)
  const upgrade = yield* updater.upgrade("npm", "9.9.9").pipe(Effect.result)
  const removal = updater.removal("npm")
  return { run, check, method, apply, latest, upgrade, removal }
}).pipe(Effect.provide(Updater.layer))

describe("updater", () => {
  test("every operation completes without a single network request", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
      Promise.reject(new Error("Olive must never contact an update server"))) as unknown as typeof fetch)
    try {
      const result = await Effect.runPromise(program)
      // The startup/background check finds nothing to do.
      expect(result.run).toBeUndefined()
      // Manual checks report updates as unavailable instead of querying a release service.
      expect(result.check).toEqual({ type: "unavailable", message: expect.stringContaining("disabled") })
      // No installation method is detected: nothing can install or remove a package.
      expect(result.method).toBeUndefined()
      expect(result.removal).toBeUndefined()
      // Self-update operations fail instead of downloading or installing anything.
      expect(result.apply._tag).toBe("Failure")
      expect(result.latest._tag).toBe("Failure")
      expect(result.upgrade._tag).toBe("Failure")
      if (result.apply._tag === "Failure") expect(result.apply.failure.message).toContain("disabled")
    } finally {
      fetchSpy.mockRestore()
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test("the updater implementation contains no update endpoints or downloads", async () => {
    const source = await Bun.file(new URL("./updater.ts", import.meta.url)).text()
    expect(source).not.toContain("http://")
    expect(source).not.toContain("https://")
    expect(source).not.toContain("fetch")
    expect(source).not.toContain("releases")
  })
})
