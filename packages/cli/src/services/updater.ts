import { Context, Effect, Layer } from "effect"

// Olive never checks for, downloads, notifies about, or installs application updates.
// This service exists only so existing call sites keep a permanently disabled
// implementation: no network requests, no release lookups, no version comparisons,
// and no installs ever happen.

export const methods = ["curl", "npm", "pnpm", "bun", "yarn", "vp", "brew", "winget"] as const

export type Method = (typeof methods)[number]
export type RunResult = { readonly type: "available" | "installed"; readonly version: string }
export type CheckResult = RunResult | { readonly type: "unavailable"; readonly message: string }

const disabled = "Automatic updates are disabled in Olive; it never checks for or installs new versions."

export interface Interface {
  readonly run: (onInstall?: (version: string) => void) => Effect.Effect<RunResult | undefined>
  readonly check: () => Effect.Effect<CheckResult | undefined>
  readonly apply: (version: string) => Effect.Effect<void, Error>
  readonly method: () => Effect.Effect<Method | undefined>
  readonly latest: (method?: Method) => Effect.Effect<string, Error>
  readonly upgrade: (method: Method, version: string) => Effect.Effect<void, Error>
  readonly removal: (
    method: Method,
  ) => { readonly command: ReadonlyArray<string>; readonly run: Effect.Effect<void, Error> } | undefined
}

export class Service extends Context.Service<Service, Interface>()("@olive/cli/Updater") {}

export const layer = Layer.sync(Service, () =>
  Service.of({
    run: () => Effect.succeed(undefined),
    check: () => Effect.succeed({ type: "unavailable" as const, message: disabled }),
    apply: () => Effect.fail(new Error(disabled)),
    method: () => Effect.succeed(undefined),
    latest: () => Effect.fail(new Error(disabled)),
    upgrade: () => Effect.fail(new Error(disabled)),
    removal: () => undefined,
  }),
)

export * as Updater from "./updater"
