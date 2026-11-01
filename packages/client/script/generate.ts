import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@olive/httpapi-codegen"
import {
  ClientApi,
  clientNamespace,
  effectOmitEndpoints,
  groupNames,
  promiseOmitEndpoints,
} from "@olive/protocol/client"
import { Agent } from "@olive/schema/agent"
import { Artifact } from "@olive/schema/artifact"
import { Command } from "@olive/schema/command"
import { Config } from "@olive/schema/config"
import { Credential } from "@olive/schema/credential"
import { Event } from "@olive/schema/event"
import { EventLog } from "@olive/schema/event-log"
import { FileDiff } from "@olive/schema/file-diff"
import { FileSystem } from "@olive/schema/filesystem"
import { Form } from "@olive/schema/form"
import { Generate } from "@olive/schema/generate"
import { Instruction } from "@olive/schema/instruction"
import { InstructionEntry } from "@olive/schema/instruction-entry"
import { Integration } from "@olive/schema/integration"
import { Location } from "@olive/schema/location"
import { Mcp } from "@olive/schema/mcp"
import { Model } from "@olive/schema/model"
import { Money } from "@olive/schema/money"
import { Permission } from "@olive/schema/permission"
import { PermissionSaved } from "@olive/schema/permission-saved"
import { Plugin } from "@olive/schema/plugin"
import { Project } from "@olive/schema/project"
import { Worktree } from "@olive/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@olive/schema/prompt"
import { PromptInput } from "@olive/schema/prompt-input"
import { Provider } from "@olive/schema/provider"
import { Pty } from "@olive/schema/pty"
import { PtyTicket } from "@olive/schema/pty-ticket"
import { Question } from "@olive/schema/question"
import { Reference } from "@olive/schema/reference"
import { AbsolutePath, RelativePath } from "@olive/schema/schema"
import { Schedule } from "@olive/schema/schedule"
import { Session } from "@olive/schema/session"
import { SessionMessage } from "@olive/schema/session-message"
import { SessionInbox } from "@olive/schema/session-inbox"
import { Shell } from "@olive/schema/shell"
import { Skill } from "@olive/schema/skill"
import { Snapshot } from "@olive/schema/snapshot"
import { UsageLimits } from "@olive/schema/usage-limits"
import { Vcs } from "@olive/schema/vcs"
import { WebSearch } from "@olive/schema/websearch"
import { Workspace } from "@olive/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: promiseOmitEndpoints,
  namespace: clientNamespace,
  aliases: true,
})
const effectContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: effectOmitEndpoints,
  namespace: clientNamespace,
  aliases: true,
})
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@olive/schema/agent", Agent),
  ...namespaceTypes("Artifact", "@olive/schema/artifact", Artifact),
  ...namespaceTypes("Command", "@olive/schema/command", Command),
  ...namespaceTypes("Config", "@olive/schema/config", Config),
  ...namespaceTypes("Credential", "@olive/schema/credential", Credential),
  ...namespaceTypes("Event", "@olive/schema/event", Event),
  ...namespaceTypes("EventLog", "@olive/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@olive/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@olive/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@olive/schema/form", Form),
  ...namespaceTypes("Generate", "@olive/schema/generate", Generate),
  ...namespaceTypes("Instruction", "@olive/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@olive/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@olive/schema/integration", Integration),
  typeReference("Location.PublicRef", "@olive/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@olive/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@olive/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@olive/schema/model", Model),
  ...namespaceTypes("Money", "@olive/schema/money", Money),
  ...namespaceTypes("Permission", "@olive/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@olive/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@olive/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@olive/schema/project", Project),
  ...namespaceTypes("Worktree", "@olive/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@olive/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@olive/schema/provider", Provider),
  ...namespaceTypes("Pty", "@olive/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@olive/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@olive/schema/question", Question),
  ...namespaceTypes("Reference", "@olive/schema/reference", Reference),
  ...namespaceTypes("Schedule", "@olive/schema/schedule", Schedule),
  ...namespaceTypes("Session", "@olive/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@olive/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@olive/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@olive/schema/shell", Shell),
  ...namespaceTypes("Skill", "@olive/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@olive/schema/snapshot", Snapshot),
  ...namespaceTypes("UsageLimits", "@olive/schema/usage-limits", UsageLimits),
  ...namespaceTypes("Vcs", "@olive/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@olive/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@olive/schema/workspace", Workspace),
  typeReference("Prompt", "@olive/schema/prompt", Prompt),
  typeReference("PromptMention", "@olive/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@olive/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@olive/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@olive/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@olive/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "OliveEvent",
              import: 'import type { OliveEvent } from "@olive/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
