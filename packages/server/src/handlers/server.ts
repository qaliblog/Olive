import { hostname } from "node:os"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { PersistentPty } from "@olive/core/persistent-pty"
import { Api } from "../api"
import { ServerInfo } from "../server-info"

export const ServerHandler = HttpApiBuilder.group(Api, "server.server", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle("server.info", () =>
      Effect.gen(function* () {
        const info = yield* ServerInfo.Service
        return {
          version: info.app.version ?? "unknown",
          pid: process.pid ?? 0,
          hostname: hostname() || undefined,
          urls: info.urls(),
          paths: info.paths,
          capabilities: { persistentPty: PersistentPty.available },
        }
      }),
    )
  }),
)
