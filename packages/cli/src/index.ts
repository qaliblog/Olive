#!/usr/bin/env bun

import { ensurePluginRuntime } from "@olive/plugin/runtime"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Cause, Effect } from "effect"
import { getErrorReported } from "effect/Runtime"
import { Commands } from "./commands/commands"
import { Runtime } from "./framework/runtime"
import { Observability } from "@olive/util/observability"
import { Updater } from "./services/updater"
import { OLIVE_ARTIFACT, OLIVE_CHANNEL, OLIVE_LOCAL, OLIVE_VERSION } from "./version"
import { LayerNode } from "@olive/util/effect/layer-node"
import { Global } from "@olive/util/global"
import { AppProcess } from "@olive/util/process"
import { Config } from "./config"
import { Npm } from "@olive/util/npm"
import { EffectFlock } from "@olive/util/effect-flock"
import { Heap } from "./heap"
import { CpuProfile } from "./cpu-profile"
import { ShutdownDeadline } from "./shutdown-deadline"

// Keep requests to the local service off any proxy. Bun reads lowercase `no_proxy` alone whenever it is set, so both
// spellings get the same merged list.
const noProxy = [
  ...new Set(
    [process.env.NO_PROXY, process.env.no_proxy, "127.0.0.1,localhost,::1"].flatMap((value) =>
      (value ?? "").split(",").flatMap((entry) => entry.trim() || []),
    ),
  ),
].join(",")

process.env.NO_PROXY = noProxy
process.env.no_proxy = noProxy

ensurePluginRuntime()

if (process.env.OLIVE_SSH_ASKPASS_PORT) {
  const { askpass } = await import("./ssh-askpass")
  process.exit(await Effect.runPromise(askpass.pipe(Effect.provide(NodeServices.layer))))
}

const Handlers = Runtime.handlers(Commands, {
  $: () => import("./commands/handlers/default"),
  uninstall: () => import("./commands/handlers/uninstall"),
  acp: () => import("./commands/handlers/acp"),
  api: () => import("./commands/handlers/api"),
  auth: {
    list: () => import("./commands/handlers/auth/list"),
    login: () => import("./commands/handlers/auth/login"),
    logout: () => import("./commands/handlers/auth/logout"),
    export: () => import("./commands/handlers/auth/export"),
    import: () => import("./commands/handlers/auth/import"),
    switch: () => import("./commands/handlers/auth/switch"),
  },
  debug: {
    agents: () => import("./commands/handlers/debug/agents"),
    config: () => import("./commands/handlers/debug/config"),
    "heap-dump": () => import("./commands/handlers/debug/heap-dump"),
    paths: () => import("./commands/handlers/debug/paths"),
  },
  mcp: {
    list: () => import("./commands/handlers/mcp/list"),
    add: () => import("./commands/handlers/mcp/add"),
    auth: () => import("./commands/handlers/mcp/auth"),
    logout: () => import("./commands/handlers/mcp/logout"),
  },
  plugin: {
    list: () => import("./commands/handlers/plugin/list"),
    add: () => import("./commands/handlers/plugin/add"),
    check: () => import("./commands/handlers/plugin/check"),
    update: () => import("./commands/handlers/plugin/update"),
    remove: () => import("./commands/handlers/plugin/remove"),
  },
  models: () => import("./commands/handlers/models"),
  provider: () => import("./commands/handlers/provider"),
  agent: () => import("./commands/handlers/agent"),
  stats: () => import("./commands/handlers/stats"),
  mini: () => import("./commands/handlers/mini"),
  run: () => import("./commands/handlers/run"),
  reload: () => import("./commands/handlers/reload"),
  session: {
    list: () => import("./commands/handlers/session/list"),
    delete: () => import("./commands/handlers/session/delete"),
    export: () => import("./commands/handlers/session/export"),
    import: () => import("./commands/handlers/session/import"),
  },
  service: {
    start: () => import("./commands/handlers/service/start"),
    restart: () => import("./commands/handlers/service/restart"),
    status: () => import("./commands/handlers/service/status"),
    stop: () => import("./commands/handlers/service/stop"),
    get: () => import("./commands/handlers/service/get"),
    set: () => import("./commands/handlers/service/set"),
    unset: () => import("./commands/handlers/service/unset"),
  },
  serve: () => import("./commands/handlers/serve"),
})

Effect.gen(function* () {
  yield* Heap.listen
  yield* CpuProfile.listen
  yield* ShutdownDeadline.install()
  const runFork = Effect.runForkWith(yield* Effect.context<never>())
  const uncaughtException = (cause: Error, origin: "uncaughtException" | "unhandledRejection") => {
    runFork(Effect.logError("uncaught exception", { cause, origin }))
  }
  const unhandledRejection = (cause: unknown) => {
    runFork(Effect.logError("unhandled rejection", { cause }))
  }
  process.on("uncaughtException", uncaughtException)
  process.on("unhandledRejection", unhandledRejection)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      process.off("uncaughtException", uncaughtException)
      process.off("unhandledRejection", unhandledRejection)
    }),
  )
  yield* Effect.logInfo("cli starting", {
    version: OLIVE_VERSION,
    channel: OLIVE_CHANNEL,
    local: OLIVE_LOCAL,
    args: process.argv.slice(2),
  })
  return yield* Runtime.run(Commands, Handlers, { version: OLIVE_VERSION })
}).pipe(
  Effect.catchCause((cause) =>
    Effect.logError("cli process failed", {
      cause,
      args: process.argv.slice(2),
    }).pipe(Effect.andThen(Effect.failCause(cause))),
  ),
  Effect.annotateLogs({ role: "cli" }),
  Effect.provide(Config.layer),
  Effect.provide(Updater.layer),
  Effect.provide(
    LayerNode.compile(LayerNode.group([Global.node, AppProcess.node, Npm.node, EffectFlock.node]), {
      replacements: [
        Global.node.replace(
          Global.layerWith(process.env.OLIVE_CONFIG_DIR ? { config: process.env.OLIVE_CONFIG_DIR } : {}),
        ),
      ],
    }),
  ),
  Effect.provide(
    Observability.layer({
      endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
      client: process.env.OLIVE_CLIENT ?? OLIVE_ARTIFACT,
      version: OLIVE_VERSION,
      channel: OLIVE_CHANNEL,
    }),
  ),
  Effect.provide(NodeServices.layer),
  Effect.scoped,
  Effect.tap(() => Effect.sync(() => process.exit(process.exitCode ?? 0))),
  // runMain's default reporter logs the fatal cause to stdout. Write it to stderr instead: the
  // desktop and `Service.ensure` only capture stderr from `serve --service`, so this is the only
  // channel through which a startup failure's reason reaches the user.
  Effect.tapCause((cause) =>
    Effect.sync(() => {
      if (Cause.hasInterruptsOnly(cause)) return
      if (!getErrorReported(Cause.squash(cause))) return
      process.stderr.write(Cause.pretty(cause) + "\n")
    }),
  ),
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
