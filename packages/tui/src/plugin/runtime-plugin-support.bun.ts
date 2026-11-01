import { ensurePluginRuntime, provides } from "@olive/plugin/runtime"
import { Plugin, PluginContextProvider, usePlugin } from "@olive/plugin/tui"
import { ensureRuntimePluginSupport } from "@opentui/solid/runtime-plugin-support/configure"

ensurePluginRuntime()
ensureRuntimePluginSupport({
  additional: {
    "@olive/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
  },
  preserve: provides,
})
