import { expect } from "bun:test"
import { Agent } from "@olive/core/agent"
import { Plugin } from "@olive/core/plugin"
import { PluginHost } from "@olive/core/plugin/host"
import { Provider } from "@olive/core/provider"
import { Model } from "@olive/schema/model"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)

it.effect("lists other model types for plugins only when they ask for them", () =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    const plugins = yield* Plugin.Service
    const catalog = yield* Provider.Service
    yield* agents.transform((editor) => editor.update(Agent.ID.make("build"), () => {}))
    const host = yield* PluginHost.make(plugins)
    const imageID = Model.ID.make("meta/muse-spark-1.1")
    yield* catalog.transform((editor) => {
      editor.models.update(Provider.ID.make("test"), imageID, (model) => {
        model.type = "image"
      })
    })
    const ids = (models: readonly Model.Info[]) => models.map((model) => model.id)

    const chat = ids((yield* host.model.list()).data)
    expect(chat).not.toContain(imageID)
    expect(ids((yield* host.model.list({ types: [] })).data)).toEqual(chat)
    expect(ids((yield* host.model.list({ types: ["image"] })).data)).toEqual([imageID])
    expect(ids((yield* host.model.list({ types: ["chat", "image"] })).data)).toEqual([...chat, imageID])
  }),
)
