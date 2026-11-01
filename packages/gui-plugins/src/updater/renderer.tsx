import type { Plugin } from "@olive/plugin/gui"
import type definition from "./index"

// Olive never updates itself. The updater plugin renders no update UI: no
// settings section, no titlebar pill, no hidden check command, and no
// "What's New" release-notes downloads.
const setup: Plugin.Setup<typeof definition> = () => {}

export default setup
