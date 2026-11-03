import { LayerNode } from "@olive/util/effect/layer-node"
import { Global } from "@olive/util/global"
import { run } from "@olive/tui"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Config } from "../../config"
import { Context, Effect, FileSystem, Option, Queue } from "effect"
import { ServerConnection } from "../../services/server-connection"
import { UpdatePreflight } from "../../services/update-preflight"
import { Npm } from "@olive/util/npm"
import { OLIVE_ARTIFACT, OLIVE_CHANNEL, OLIVE_VERSION } from "../../version"
import { Env } from "../../env"
import { Service } from "@olive/client/effect/service"
import { Olive } from "@olive/client/promise"
import { OliveProvider } from "@olive/core/olive/provider"
import { findSession } from "../../session-target"
import { errorMessage } from "../../util/error"

export default Runtime.handler(Commands, (input) =>
  Effect.gen(function* () {
    const requestedDirectory = Option.getOrUndefined(input.directory)
    const requestedServer = Option.getOrUndefined(input.server)
    if (requestedDirectory !== undefined) process.chdir(requestedDirectory)
    const preflight = UpdatePreflight.make()
    yield* Effect.addFinalizer(() => Effect.promise(() => preflight.close()))
    const serviceStarts = yield* Queue.unbounded<{
      readonly reason: "missing" | "version-mismatch"
      readonly previousVersion?: string
    }>()
    yield* Queue.take(serviceStarts).pipe(
      Effect.flatMap((event) => Effect.logInfo("background service starting", event)),
      Effect.forever,
      Effect.forkScoped,
    )
    const server = yield* ServerConnection.resolve({
      server: requestedServer,
      standalone: input.standalone,
      mismatch: "replace",
      onStart: (reason, previousVersion) => {
        Queue.offerUnsafe(serviceStarts, { reason, previousVersion })
        if (reason === "version-mismatch" && preflight.begin(previousVersion)) return
        process.stderr.write(
          reason === "version-mismatch"
            ? "Restarting background server (version mismatch)...\n"
            : "Starting background server...\n",
        )
      },
    }).pipe(
      Effect.tapError(() =>
        Effect.promise(() => preflight.fail("Olive could not start the new background service")),
      ),
    )
    const session = Option.getOrUndefined(input.session)
    // A missing --session ID becomes the ID of the session the first prompt creates.
    const sessionExists =
      session !== undefined &&
      (yield* Effect.tryPromise({
        try: () =>
          findSession(Olive.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) }), session),
        catch: (cause) => new Error(errorMessage(cause)),
      })) !== undefined
    // Olive never checks for application updates: no background update loop runs here.
    preflight.loading()
    const config = yield* Config.Service
    const npm = yield* Npm.Service
    const fileSystem = yield* FileSystem.FileSystem
    const runServicePromise = Effect.runPromiseWith(Context.make(FileSystem.FileSystem, fileSystem))
    const context = yield* Effect.context<FileSystem.FileSystem>()
    const runFork = Effect.runForkWith(context)
    const runPromise = Effect.runPromiseWith(context)
    const service = server.service
    // A configured Olive provider becomes the session default, so plain `olive` opens the chat on the local model
    // instead of whichever inherited catalog model happens to be listed first.
    const olive = yield* Effect.promise(() => OliveProvider.load({ directory: process.cwd() }))
    const preferred = olive.default ??
      olive.providers.flatMap((provider) => {
        const model = provider.models[0]
        return model ? [{ provider: provider.id, model: model.id }] : []
      })[0]
    yield* run({
      app: {
        name: process.env.OLIVE_CLIENT ?? OLIVE_ARTIFACT,
        version: OLIVE_VERSION,
        channel: process.env.OLIVE_TUI_CHANNEL ?? OLIVE_CHANNEL,
      },
      server: {
        endpoint: server.endpoint,
        // Managed and standalone servers run here; an explicit --server may be on another machine.
        local: requestedServer === undefined,
        service: service
          ? {
              reconnect: (signal) => runServicePromise(service.reconnect(), { signal }),
              restart: () => runServicePromise(service.restart()),
            }
          : undefined,
      },
      args: {
        continue: input.continue,
        sessionID: sessionExists ? session : undefined,
        newSessionID: sessionExists ? undefined : session,
        prompt: Option.getOrUndefined(input.prompt),
        auto: input.auto || input.yolo || input.dangerouslySkipPermissions,
        ...(preferred ? { model: `${preferred.provider}/${preferred.model}` } : {}),
      },
      config: {
        path: config.path,
        get: () => runPromise(config.get()),
        update: (update) => runPromise(config.update(update)),
      },
      packages: {
        prepare: (spec, install = true) => runPromise(install ? npm.add(spec) : npm.resolve(spec)),
      },
      environment: requestedServer === undefined ? Env.session() : undefined,
      terminalHandoff: () => preflight.finish(),
      log: (level, message, tags) => {
        const effect =
          level === "debug"
            ? Effect.logDebug(message, tags)
            : level === "warn"
              ? Effect.logWarning(message, tags)
              : level === "error"
                ? Effect.logError(message, tags)
                : Effect.logInfo(message, tags)
        runFork(effect)
      },
    }).pipe(Effect.provide(LayerNode.compile(Global.node)))
  }),
)
