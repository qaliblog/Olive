import { OliveConfigPlugin } from "./provider/olive-config.js"
import type { PluginInternal } from "./internal.js"

/**
 * Olive owns its provider catalog. Only providers declared in olive.json are registered, so no inherited
 * vendor integration can introduce a provider, model, or credential flow that Olive does not configure itself.
 */
export const ProviderPlugins: PluginInternal.InternalPlugin[] = [OliveConfigPlugin]
