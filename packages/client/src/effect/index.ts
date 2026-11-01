// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { Olive } from "./client.js"

export * from "./generated/index"
export { Olive } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@olive/schema/agent"
export { Command } from "@olive/schema/command"
export { Config } from "@olive/schema/config"
export { Credential } from "@olive/schema/credential"
export { Event } from "@olive/schema/event"
export { EventLog } from "@olive/schema/event-log"
export { FileSystem } from "@olive/schema/filesystem"
export { Form } from "@olive/schema/form"
export { Integration } from "@olive/schema/integration"
export { Location } from "@olive/schema/location"
export { Model } from "@olive/schema/model"
export { Permission } from "@olive/schema/permission"
export { PermissionSaved } from "@olive/schema/permission-saved"
export { Project } from "@olive/schema/project"
export { Worktree } from "@olive/schema/worktree"
export { Vcs } from "@olive/schema/vcs"
export { Provider } from "@olive/schema/provider"
export { Pty } from "@olive/schema/pty"
export { Question } from "@olive/schema/question"
export { Reference } from "@olive/schema/reference"
export { WebSearch } from "@olive/schema/websearch"
export { AbsolutePath, RelativePath } from "@olive/schema/schema"
export { Session } from "@olive/schema/session"
export { SessionInbox } from "@olive/schema/session-inbox"
export { SessionMessage } from "@olive/schema/session-message"
export { Skill } from "@olive/schema/skill"
export { Prompt } from "@olive/schema/prompt"
export { PromptInput } from "@olive/schema/prompt-input"
export type { OliveEvent } from "@olive/protocol/groups/event"
export type OliveClient = Effect.Success<ReturnType<typeof Olive.make>>
