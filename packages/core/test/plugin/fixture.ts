import { Agent } from "@olive/core/agent"
import { Artifact } from "@olive/core/artifact"
import { AISDK } from "@olive/core/aisdk"
import { Command } from "@olive/core/command"
import { Config } from "@olive/core/config"
import { Credential } from "@olive/core/credential"
import { Database } from "@olive/core/database/database"
import { Environment } from "@olive/core/environment/index"
import { FileAccess } from "@olive/core/file-access"
import { LayerNodePlatform } from "@olive/util/effect/app-node-platform"
import { AppProcess } from "@olive/util/process"
import { LayerNode } from "@olive/util/effect/layer-node"
import { Bus } from "@olive/core/bus"
import { FileSystem } from "@olive/core/filesystem"
import { FSUtil } from "@olive/util/fs-util"
import { Global } from "@olive/util/global"
import { Form } from "@olive/core/form"
import { Generate } from "@olive/core/generate"
import { Integration } from "@olive/core/integration"
import { Job } from "@olive/core/job"
import { KV } from "@olive/core/kv"
import { Location } from "@olive/core/location"
import { Mcp } from "@olive/core/mcp/index"
import { Model } from "@olive/core/model"
import { Npm } from "@olive/util/npm"
import { Plugin } from "@olive/core/plugin"
import { PluginHooks } from "@olive/core/plugin/hooks"
import { Provider } from "@olive/core/provider"
import { Session } from "@olive/core/session"
import { SharedCache } from "@olive/core/shared-cache"
import { InstructionEntry } from "@olive/core/session/instruction-entry"
import { PersistentPty } from "@olive/core/persistent-pty"
import { LocationServiceMap } from "@olive/core/location-service-map"
import { AppNodeBuilder } from "@olive/core/effect/app-node-builder"
import { Permission } from "@olive/core/permission"
import { Reference } from "@olive/core/reference"
import { Rpc } from "@olive/core/rpc"
import { Skill } from "@olive/core/skill"
import { SkillDiscovery } from "@olive/core/skill/discovery"
import { Watcher } from "@olive/core/filesystem/watcher"
import { Tool } from "@olive/core/tool"
import { Vcs } from "@olive/core/vcs"
import { WebSearch } from "@olive/core/websearch"
import { Worktree } from "@olive/core/worktree"
import { WorktreeStrategies } from "@olive/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { offlineModels } from "../fixture/models"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(
  Generate.Service,
  Generate.Service.of({
    text: () => Effect.succeed(""),
    image: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
  }),
)

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const makePluginTestLayer = (permission = permissionLayer, generate = generateLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Database.node,
      Environment.node,
      FileAccess.node,
      Global.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      Artifact.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      Integration.node,
      Job.node,
      KV.node,
      Mcp.node,
      Session.node,
      SharedCache.node,
      InstructionEntry.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generate),
      Permission.node.replace(permission),
      offlineModels,
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const PluginTestLayer = makePluginTestLayer()
