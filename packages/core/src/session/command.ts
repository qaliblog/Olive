export * as SessionCommand from "./command.js"

import type { PromptInput } from "@olive/schema/prompt-input"
import type { Session } from "@olive/schema/session"
import type { SessionInbox } from "@olive/schema/session-inbox"
import { Effect } from "effect"
import { Command } from "../command.js"
import { Instance } from "../instance/service.js"
import { Plugin } from "../plugin/service.js"

export const execute = Effect.fn("SessionCommand.execute")(function* (input: {
  session: Session.Info
  command: string
  text: string
  files?: PromptInput.Prompt["files"]
  agents?: PromptInput.Prompt["agents"]
  skills?: PromptInput.Prompt["skills"]
  delivery?: SessionInbox.Delivery
}) {
  const instances = yield* Instance.Service
  yield* Effect.gen(function* () {
    yield* Plugin.awaitActivation
    const commands = yield* Command.Service
    yield* commands.execute({
      name: input.command,
      invocation: {
        sessionID: input.session.id,
        prompt: {
          text: input.text,
          files: input.files,
          agents: input.agents,
          skills: input.skills,
        },
        delivery: input.delivery ?? "steer",
      },
    })
  }).pipe(instances.provide(input.session))
})
