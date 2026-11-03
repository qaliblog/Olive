import { OliveAgent } from "@olive/core/olive/agent"
import { OliveProvider } from "@olive/core/olive/provider"
import { OliveTaskState } from "@olive/core/olive/task-state"
import { Effect, Option } from "effect"
import { EOL } from "node:os"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

const guidance = [
  "No Olive provider is configured.",
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

export default Runtime.handler(
  Commands.commands.agent,
  Effect.fn("cli.agent")(function* (input) {
    const directory = Option.getOrUndefined(input.directory) ?? process.cwd()
    const model = Option.getOrUndefined(input.model)
    const maxSteps = Option.getOrUndefined(input.maxSteps)
    yield* Effect.promise(async () => {
      const file = OliveAgent.stateFile(directory)
      const saved = input.continue ? await OliveTaskState.read(file) : undefined
      const objective = input.objective.join(" ").trim() || saved?.objective || ""
      if (objective.length === 0) {
        process.stderr.write(`Usage: olive agent [--directory <path>] [--model provider/model] <objective>${EOL}`)
        process.exitCode = 2
        return
      }
      const registry = await OliveProvider.load({ directory })
      if (registry.providers.length === 0) {
        process.stderr.write(`${guidance}${EOL}`)
        process.exitCode = 1
        return
      }
      const outcome = await OliveAgent.run({
        registry,
        directory,
        objective,
        state: OliveTaskState.store(file, objective),
        ...(model ? { requested: model } : {}),
        ...(maxSteps ? { maxSteps } : {}),
        onEvent: (event) => {
          if (event.type === "step") process.stderr.write(`${EOL}[step ${event.step}, ${event.tokens} prompt tokens]${EOL}`)
          if (event.type === "text") process.stdout.write(event.text)
          if (event.type === "tool")
            process.stderr.write(`${event.result.ok ? "ok" : "failed"} ${event.result.tool}${EOL}`)
          if (event.type === "error") process.stderr.write(`${EOL}error: ${event.message}${EOL}`)
        },
      }).catch((cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))))
      if (outcome instanceof OliveProvider.ProviderDiagnostic) {
        process.stderr.write(`${outcome.code}: ${outcome.message}${EOL}`)
        process.exitCode = 1
        return
      }
      if (outcome instanceof Error) {
        process.stderr.write(`agent failed: ${outcome.message}${EOL}`)
        process.exitCode = 1
        return
      }
      process.stderr.write(
        `${EOL}${outcome.completed ? "completed" : "incomplete"} in ${outcome.steps} step(s); state: ${file}${EOL}`,
      )
      if (outcome.task.files.length > 0) process.stderr.write(`files: ${outcome.task.files.join(", ")}${EOL}`)
      if (outcome.error) process.stderr.write(`error: ${outcome.error}${EOL}`)
      if (!outcome.completed) process.exitCode = 1
    })
  }),
)
