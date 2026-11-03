import { OliveProvider } from "@olive/core/olive/provider"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

const capability = (label: string, enabled: boolean) => (enabled ? label : `${label}-off`)

export default Runtime.handler(
  Commands.commands.provider,
  Effect.fn("cli.provider")(function* () {
    const report = yield* Effect.promise(async () => {
      const registry = await OliveProvider.load({ directory: process.cwd() })
      if (registry.providers.length === 0)
        return [
          "No Olive providers are configured.",
          "",
          "Add one to ~/.config/olive/olive.json or .olive/olive.json:",
          "",
          "  {",
          '    "providers": {',
          '      "local": {',
          '        "id": "local",',
          '        "type": "openai-compatible",',
          '        "baseURL": "http://127.0.0.1:11434/v1",',
          '        "apiKeyEnv": "LOCAL_API_KEY",',
          '        "models": [{ "id": "olive", "context": 4096, "maxOutput": 512, "tools": true }]',
          "      }",
          "    }",
          "  }",
        ].join(EOL)
      const lines: string[] = []
      for (const provider of registry.providers) {
        const endpoint = (() => {
          try {
            return OliveProvider.chatURL(provider)
          } catch (cause) {
            return cause instanceof OliveProvider.ProviderDiagnostic ? `invalid: ${cause.message}` : "invalid endpoint"
          }
        })()
        lines.push(
          `${provider.id} (${provider.name}) — ${provider.type}, ${provider.local ? "local" : "remote"}`,
          `  endpoint: ${endpoint}`,
          `  credential: ${provider.apiKeyEnv ? `${provider.apiKeyEnv} (${provider.hasCredential ? "set" : "missing"})` : provider.hasCredential ? "configured" : "none"}`,
          "  models:",
          ...provider.models.map(
            (model) =>
              `    ${model.id} — context ${model.context}, output ${model.maxOutput}, ${[
                capability("streaming", model.streaming),
                capability("tools", model.tools),
                capability("json", model.json),
              ].join(", ")}`,
          ),
        )
      }
      lines.push("", `sources: ${registry.sources.length > 0 ? registry.sources.join(", ") : "none"}`)
      return lines.join(EOL)
    })
    process.stdout.write(report + EOL)
  }),
)
