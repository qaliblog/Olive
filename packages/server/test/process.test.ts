import { expect } from "bun:test"
import { Effect } from "effect"
import { HttpServer } from "effect/http"
import { it } from "../../core/test/lib/effect"
import { ServerProcess } from "../src/process"

const secret = btoa("olive:secret")

it.live("authenticates API requests and serves the event stream", () =>
  Effect.gen(function* () {
    const server = yield* ServerProcess.start<never, never>({
      hostname: "127.0.0.1",
      port: 0,
      password: "secret",
      app: { version: "test-version" },
      database: { path: ":memory:" },
    })
    const url = (pathname: string) => new URL(pathname, HttpServer.formatAddress(server.address))

    // Cross-origin browser pages are not a supported client, so OPTIONS is not answered without credentials.
    const preflight = yield* Effect.promise(() =>
      fetch(url("/api/info"), {
        method: "OPTIONS",
        headers: { origin: "http://localhost:3000", "access-control-request-method": "GET" },
      }),
    )
    expect(preflight.status).toBe(401)

    const info = yield* Effect.promise(() =>
      fetch(url("/api/info"), { headers: { authorization: `Basic ${secret}` } }),
    )
    expect(info.status).toBe(200)
    expect(yield* Effect.promise(() => info.json())).toMatchObject({ version: "test-version" })

    yield* Effect.forEach(["/api", "/api/missing", "/openapi.json"], (pathname) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => fetch(url(pathname)))
        expect(response.status).toBe(401)
        expect(yield* Effect.promise(() => response.json())).toEqual({
          _tag: "UnauthorizedError",
          message: "Authentication required",
        })
      }),
    )

    const event = yield* Effect.promise(() =>
      fetch(url("/api/event"), { headers: { "accept-encoding": "br", authorization: `Basic ${secret}` } }),
    )
    expect(event.status).toBe(200)
    expect(event.headers.get("content-encoding")).toBeNull()
    const body = event.body
    if (!body) return yield* Effect.die(new Error("Event response has no body"))
    const reader = body.getReader()
    yield* Effect.promise(() => readUntil(reader, "server.connected"))
    yield* server.updateAvailable("2.0.0")
    yield* Effect.promise(() => readUntil(reader, "installation.update-available"))
    yield* server.updated("2.0.0")
    yield* Effect.promise(() => readUntil(reader, "installation.updated"))
    yield* Effect.promise(() => reader.cancel())
  }),
)

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, expected: string) {
  while (true) {
    const next = await reader.read()
    if (next.done) throw new Error(`Event stream ended before ${expected}`)
    if (new TextDecoder().decode(next.value).includes(expected)) return
  }
}
