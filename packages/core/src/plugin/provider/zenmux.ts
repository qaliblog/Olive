import { Effect } from "effect"
import { define } from "@olive/plugin/effect/plugin"

export const ZenmuxPlugin = define({
  id: "olive.provider.zenmux",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.provider.transform((evt) => {
      for (const item of evt.list()) {
        if (item.provider.package !== "@olive/ai/providers/openai-compatible") continue
        if (item.provider.settings?.baseURL !== "https://zenmux.ai/api/v1") continue
        evt.update(item.provider.id, (provider) => {
          provider.headers = {
            "HTTP-Referer": "https://olive.ai/",
            "X-Title": "olive",
            ...provider.headers,
          }
        })
      }
    })
  }),
})
