export * as ServerProcess from "./server-process"

import { NodeServices } from "@effect/platform-node"
import { Service } from "@olive/client/effect/service"
import { LayerNode } from "@olive/util/effect/layer-node"
import { Global } from "@olive/util/global"
import { OLIVE_ARTIFACT, OLIVE_CHANNEL, OLIVE_VERSION } from "./version"
import { AppProcess } from "@olive/util/process"
import { randomBytes, randomUUID } from "node:crypto"
import { Effect, Option, Redacted, Schema } from "effect"
import { PersistentPty } from "@olive/schema/persistent-pty"
import { HttpServer } from "effect/http"
import { Env } from "./env"
import { PortOwner } from "./services/port-owner"
import { ServiceConfig } from "./services/service-config"
import { RetainedImage } from "./services/retained-image"
import { ServiceRegistration } from "./services/service-registration"
import { databasePath } from "./database-path"

export type Mode = "default" | "service" | "stdio"

export type Options = {
  readonly mode: Mode
  readonly hostname?: string
  readonly port?: number
}

// The process effect lives until server shutdown; tracing it would parent every request to one process-lifetime trace.
export const run = Effect.fnUntraced(function* (options: Options) {
  return yield* processEffect(options).pipe(
    Effect.provide(
      LayerNode.compile(LayerNode.group([Global.node, AppProcess.node]), {
        replacements: [
          Global.node.replace(
            Global.layerWith(process.env.OLIVE_CONFIG_DIR ? { config: process.env.OLIVE_CONFIG_DIR } : {}),
          ),
        ],
      }),
    ),
    Effect.provide(NodeServices.layer),
  )
})

const processEffect = Effect.fnUntraced(function* (options: Options) {
  const inherited = process.env.OLIVE_PTY_HANDOFF
  delete process.env.OLIVE_PTY_HANDOFF
  const handoff =
    inherited === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PersistentPty.Handoff))(inherited).pipe(
          Effect.catch(() =>
            Effect.logWarning("Ignoring invalid PTY restart handoff; persistent terminals will start fresh").pipe(
              Effect.as(undefined),
            ),
          ),
        )
  const global = yield* Global.Service
  // A sandbox may deny $HOME; the service then keeps the cwd it was launched from.
  if (options.mode === "service")
    yield* Effect.try(() => process.chdir(global.home)).pipe(
      Effect.catch((cause) => Effect.logWarning("failed to change service directory to home", { cause })),
    )
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const foreground = options.mode === "default"
      const serviceOptions = options.mode === "service" ? yield* ServiceConfig.options() : undefined
      const config = options.mode === "service" ? yield* ServiceConfig.read() : {}
      const hostname = options.hostname ?? config.hostname ?? "127.0.0.1"
      const port = options.port ?? config.port ?? (options.mode === "service" ? ServiceConfig.defaultPort() : undefined)
      const findIncumbent =
        serviceOptions !== undefined && port !== undefined
          ? Service.incumbent({ ...serviceOptions, url: serviceURL(hostname, port) })
          : undefined
      if (findIncumbent !== undefined && (yield* findIncumbent) !== undefined) return
      // Desktop can launch the service directly without injecting its saved environment.
      Object.assign(process.env, ServiceConfig.processEnv(config.env))
      // Keep a package-manager or curl install replaceable while the service runs; Desktop updates its own copy.
      if (options.mode === "service" && process.platform === "win32" && RetainedImage.installed(global.home))
        yield* RetainedImage.retain(global.cache, "service")
      const { start } = yield* Effect.promise(() => import("@olive/server/process"))
      const environmentPassword = yield* Env.password
      // Keep the lease credential out of the environment inherited by tools.
      if (options.mode === "stdio") {
        delete process.env.OLIVE_PASSWORD
        delete process.env.OLIVE_SERVER_PASSWORD
      }
      const password =
        options.mode === "service"
          ? config.password || randomBytes(32).toString("base64url")
          : environmentPassword
            ? Redacted.value(environmentPassword)
            : randomBytes(32).toString("base64url")
      if (!password) return yield* Effect.fail(new Error("Missing server password"))
      const instanceID = randomUUID()
      const launch = start(
        {
          app: {
            name: process.env.OLIVE_CLIENT ?? OLIVE_ARTIFACT,
            version: OLIVE_VERSION,
            channel: OLIVE_CHANNEL,
          },
          hostname,
          port,
          password,
          pty: { handoff },
          simulation: truthy(process.env.OLIVE_SIMULATE),
          database: {
            path: databasePath(global.data),
          },
          models: {
            url: process.env.OLIVE_MODELS_URL,
            file: process.env.OLIVE_MODELS_PATH,
            fetch: !truthy(process.env.OLIVE_DISABLE_MODELS_FETCH),
          },
          config: {
            directory: process.env.OLIVE_CONFIG_DIR,
            project: !truthy(
              process.env.OLIVE_CONFIG_PROJECT_DISABLE ?? process.env.OLIVE_DISABLE_PROJECT_CONFIG,
            ),
            // .claude is only read for skills, so both flags gate the same roots.
            claude: !(
              truthy(process.env.OLIVE_DISABLE_CLAUDE_CODE) ||
              truthy(process.env.OLIVE_DISABLE_CLAUDE_CODE_SKILLS)
            ),
            file: process.env.OLIVE_CONFIG,
            content: process.env.OLIVE_CONFIG_CONTENT,
          },
          windows: {
            gitbash: process.env.OLIVE_GIT_BASH_PATH,
          },
          fs: {
            filewatcher: !truthy(process.env.OLIVE_FILEWATCHER_DISABLE ?? process.env.OLIVE_DISABLE_FILEWATCHER),
            fff:
              process.env.OLIVE_DISABLE_FFF === undefined
                ? process.platform !== "win32"
                : !truthy(process.env.OLIVE_DISABLE_FFF),
          },
        },
        serviceOptions === undefined
          ? undefined
          : {
              onListen: (address, shutdown) =>
                Effect.gen(function* () {
                  if (!config.password) yield* ServiceConfig.password(password)
                  return yield* ServiceRegistration.register({
                    address,
                    password,
                    id: instanceID,
                    file: serviceOptions.file,
                    shutdown,
                  })
                }),
            },
        )
      const server = yield* launch.pipe(
        Effect.catch((error) => {
          if (findIncumbent === undefined || !addressInUse(error)) return Effect.fail(error)
          return Effect.gen(function* () {
            const deadline = Date.now() + 15_000
            while (Date.now() < deadline) {
              const found = yield* findIncumbent.pipe(Effect.timeoutOption(deadline - Date.now()))
              if (Option.isSome(found) && found.value !== undefined) return
              yield* Effect.sleep("100 millis")
              if (Date.now() >= deadline) break
              // Failed binds close their scope; a successful bind may take longer than this window to boot.
              const server = yield* launch.pipe(Effect.catchIf(addressInUse, () => Effect.void))
              if (server !== undefined) return server
            }
            const owner = port === undefined ? undefined : yield* PortOwner.describe(port, hostname)
            return yield* Effect.fail(
              new Error(
                `Managed service port ${port} on ${hostname} is already in use by ${owner ?? "another process"}. ` +
                  "Configure another port with `olive service set port <port>` and start the service again.",
                { cause: error },
              ),
            )
          })
        }),
      )
      if (server === undefined) return
      const url = HttpServer.formatAddress(server.address)
      console.log(options.mode === "stdio" ? JSON.stringify({ url }) : `server listening on ${url}`)
      if (foreground && !environmentPassword) console.log(`server password ${password}`)
      return yield* options.mode === "service"
        ? server.shutdown
        : options.mode === "stdio"
          ? waitForStdinClose()
          : Effect.never
    }).pipe(Effect.annotateLogs({ role: "server" })),
  )
})

function serviceURL(hostname: string, port: number) {
  return `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`
}

function truthy(value?: string) {
  return value === "1" || value?.toLowerCase() === "true"
}

function addressInUse(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  if ("code" in error && error.code === "EADDRINUSE") return true
  return "cause" in error && addressInUse(error.cause)
}

function waitForStdinClose() {
  return Effect.callback<void>((resume) => {
    const close = () => resume(Effect.void)
    process.stdin.once("end", close)
    process.stdin.once("close", close)
    process.stdin.resume()
    if (process.stdin.readableEnded || process.stdin.destroyed) close()
    return Effect.sync(() => {
      process.stdin.off("end", close)
      process.stdin.off("close", close)
      process.stdin.pause()
    })
  })
}
