import { Plugin } from "@olive/plugin/tui"
import { createMermaidCodeBlockRenderer } from "./markdown.js"
import { resolveOliveDiagramPalette } from "./palette.js"

export default Plugin.define({
  id: "olive.merman",
  setup(context) {
    context.markdown.registerCodeBlockRenderer(
      "mermaid",
      createMermaidCodeBlockRenderer(context.renderer, () => ({
        colors: resolveOliveDiagramPalette(context.theme, context.themeMode),
      })),
    )
  },
})
