export * as OliveWorkerd from "./workerd"

import { Layer } from "effect"
import type { Config, Scope } from "effect"
import { WorkerdProfile } from "../internal/workerd"
import { Olive } from "./olive"

export type Configuration = WorkerdProfile.Configuration

export interface CreateOptions<R = never> extends WorkerdProfile.Options {
  readonly log?: Olive.CreateOptions["log"]
  readonly plugins?: Olive.CreateOptions["plugins"]
  readonly workspaceProviders?: Olive.CreateOptions["workspaceProviders"]
  readonly instances?: Olive.CreateOptions<R>["instances"]
}

export const create = <R = never>({ log, plugins, workspaceProviders, instances, ...options }: CreateOptions<R>) => {
  const profile = WorkerdProfile.make(options)
  return Olive.create(
    { ...profile.options, log, plugins, workspaceProviders, instances },
    { overrides: profile.replacements },
  )
}

export const layer = <R = never>(
  options: CreateOptions<R>,
): Layer.Layer<Olive.Service, Config.ConfigError | Error, Exclude<R, Scope.Scope>> =>
  Layer.effect(Olive.Service, create(options))

export type Interface = Olive.Interface
export type Requirements = Scope.Scope
