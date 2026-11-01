import type { FileSystem } from "@olive/core/filesystem"
import { Bus } from "@olive/core/bus"
import { Image } from "@olive/core/image"
import { LocationServiceMap } from "@olive/core/location-service-map"
import type { LocationServices } from "@olive/core/location-services"
import { Plugin } from "@olive/core/plugin"
import { PluginHooks } from "@olive/core/plugin/hooks"
import { Skill } from "@olive/core/skill"
import type { Location } from "@olive/schema/location"
import { makeGlobalNode } from "@olive/util/effect/app-node"
import { LayerNode } from "@olive/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node]), {
            replacements: [
              Bus.node.replace(Layer.succeed(Bus.Service, bus)),
              Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            ],
          }) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})
