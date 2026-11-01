export * as CodeModeExecution from "./execution.js"

import type { Context as ToolContext } from "@olive/schema/tool"
import { Context } from "effect"

/** The `execute` call a Code Mode program runs under, so extensions can act for its session like a tool does. */
export class Service extends Context.Service<Service, ToolContext>()("@olive/CodeModeExecution") {}
