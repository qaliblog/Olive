import { Plugin } from "@olive/plugin/gui"
import { Updater, type UpdaterState } from "@olive/plugin/gui/updater"

// Olive never checks for, downloads, or installs application updates. The desktop
// updater is permanently disabled: its state is always `disabled`, checks report
// the same without any network access, and installs do nothing. No menu entry, no
// titlebar pill, and no update dialog are registered.
const setup: Plugin.MainSetup = (ctx) => {
  const disabled: UpdaterState = { status: "disabled" }
  ctx.provide(Updater, {
    state: () => disabled,
    check: () => disabled,
    install: () => {},
  })
}

export default setup
