import { Plugin } from "@olive/plugin/tui"
import { createLatexCodeBlockRenderer } from "./markdown"

export default Plugin.define({
  id: "olive.latex",
  setup(context) {
    const render = createLatexCodeBlockRenderer(context.renderer, () => ({
      text: context.theme.text.base,
      subdued: context.theme.text.muted,
    }))
    context.markdown.registerCodeBlockRenderer("latex", render)
    context.markdown.registerCodeBlockRenderer("math", render)
  },
})
