export * as OliveContextBudget from "./context-budget.js"

/**
 * Context is a strictly limited resource here. Every budget comes from the configured model's real capacity, never
 * from an assumed 32K or 128K window, and the allocation is expressed in tokens after reserving generation space.
 */

export const Section = ["system", "task", "code", "conversation", "toolResults"] as const
export type Section = (typeof Section)[number]

export interface Allocation {
  readonly system: number
  readonly task: number
  readonly code: number
  readonly conversation: number
  readonly toolResults: number
  /** Share of the window reserved for the model's own output. */
  readonly generation: number
}

export const DEFAULT_ALLOCATION: Allocation = {
  system: 0.15,
  task: 0.15,
  code: 0.35,
  conversation: 0.15,
  toolResults: 0.1,
  generation: 0.1,
}

/**
 * A larger window is not a uniformly scaled version of a small one: what is worth keeping changes with the space
 * available, so each tier reweights the sections and caps how many items may enter them. The tier is chosen from the
 * tokens actually usable for the prompt - after the generation reserve - never from the model's advertised maximum,
 * because a declared 32K window that cannot prefill without exhausting a T4 is not 32K of usable context.
 */
export const Tiers = ["under4k", "4k_to_8k", "8k_to_16k", "over16k"] as const
export type Tier = (typeof Tiers)[number]

export interface Limits {
  /** Maximum code items carried into the prompt. */
  readonly code: number
  /** Maximum conversation messages kept before compaction. */
  readonly conversation: number
  /** Maximum tool results carried into the prompt. */
  readonly toolResults: number
}

interface Policy {
  readonly allocation: Omit<Allocation, "generation">
  readonly limits: Limits
}

/**
 * Below 4K there is room for the next action, a few symbols, and the last result. Extra space goes to code first, then
 * to history, then to larger source sections; it is never spread evenly across every section.
 */
const POLICIES: Readonly<Record<Tier, Policy>> = {
  under4k: {
    allocation: { system: 0.14, task: 0.24, code: 0.3, conversation: 0.06, toolResults: 0.26 },
    // Four, not two: one assistant call plus its two results is three messages, and a cap that splits that group
    // hides the model's own call from the next request.
    limits: { code: 4, conversation: 4, toolResults: 2 },
  },
  "4k_to_8k": {
    allocation: { system: 0.14, task: 0.18, code: 0.33, conversation: 0.12, toolResults: 0.23 },
    limits: { code: 8, conversation: 6, toolResults: 4 },
  },
  "8k_to_16k": {
    allocation: { system: 0.12, task: 0.16, code: 0.35, conversation: 0.22, toolResults: 0.15 },
    limits: { code: 14, conversation: 14, toolResults: 6 },
  },
  over16k: {
    allocation: { system: 0.1, task: 0.14, code: 0.4, conversation: 0.26, toolResults: 0.1 },
    limits: { code: 24, conversation: 30, toolResults: 10 },
  },
}

/** The tier boundary is applied to usable prompt tokens, so `4k_to_8k` means 4096-8191 prompt tokens. */
export function tierOf(prompt: number): Tier {
  if (prompt < 4096) return "under4k"
  if (prompt < 8192) return "4k_to_8k"
  if (prompt < 16384) return "8k_to_16k"
  return "over16k"
}

export function limitsOf(tier: Tier): Limits {
  return POLICIES[tier].limits
}

/**
 * Heuristic estimate used when a tokenizer is not configured; it never claims to be exact model tokenization. Latin
 * text averages four characters per token, while scripts such as Persian or Arabic tokenize at roughly one to two
 * characters per token, so counting them at four would overflow the window for exactly the users this agent supports.
 */
export function estimateTokens(text: string) {
  if (text.length === 0) return 0
  const nonAscii = text.match(/[^\x00-\x7f]/g)?.length ?? 0
  return Math.max(1, Math.ceil((text.length - nonAscii + nonAscii * 3) / 4))
}

export interface PlanInput {
  readonly context: number
  readonly maxOutput: number
  readonly allocation?: Partial<Allocation>
}

export interface Plan {
  readonly context: number
  readonly generation: number
  readonly sections: Readonly<Record<Section, number>>
  /** Tokens available to prompt sections, excluding the generation reserve. */
  readonly prompt: number
  /** Which retention policy was applied, derived from `prompt`. */
  readonly tier: Tier
  readonly limits: Limits
}

export function plan(input: PlanInput): Plan {
  if (!Number.isFinite(input.context) || input.context < 2) throw new Error("context must be at least 2 tokens")
  if (!Number.isFinite(input.maxOutput) || input.maxOutput < 1) throw new Error("maxOutput must be at least 1 token")
  const allocation = { ...DEFAULT_ALLOCATION, ...input.allocation }
  const context = Math.floor(input.context)
  const generation = Math.min(Math.floor(input.maxOutput), Math.max(1, Math.floor(context * allocation.generation)), context - 1)
  const prompt = context - generation
  const tier = tierOf(prompt)
  // An explicit allocation wins over the tier policy: the overflow retry narrows code and history on purpose.
  const policy = input.allocation ? allocation : { ...allocation, ...POLICIES[tier].allocation }
  const weights = Section.map((section) => [section, Math.max(0, policy[section])] as const)
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0) || 1
  const sections = weights.reduce<Record<Section, number>>(
    (result, [section, weight]) => ({ ...result, [section]: Math.floor((prompt * weight) / total) }),
    { system: 0, task: 0, code: 0, conversation: 0, toolResults: 0 },
  )
  // Flooring leaves a remainder; the code section carries it because it is the largest consumer.
  const assigned = Section.reduce((sum, section) => sum + sections[section], 0)
  sections.code += prompt - assigned
  return { context, generation, sections, prompt, tier, limits: POLICIES[tier].limits }
}

export type ItemKind = "symbol" | "snippet" | "summary" | "file"

export interface Item {
  readonly id: string
  readonly text: string
  readonly kind?: ItemKind
  /** Higher values are kept first. */
  readonly priority?: number
  /** File this item came from, used to prefer symbol-level context over whole files. */
  readonly file?: string
}

const KIND_RANK: Record<ItemKind, number> = { symbol: 0, snippet: 1, summary: 2, file: 3 }

/**
 * Drops whole-file items for any file already represented by a symbol or snippet, so the same source never occupies
 * the window twice at two levels of detail.
 */
export function preferSymbols(items: readonly Item[]) {
  const detailed = new Set(
    items.filter((item) => item.file && (item.kind === "symbol" || item.kind === "snippet")).map((item) => item.file),
  )
  return items.filter((item) => !(item.kind === "file" && item.file && detailed.has(item.file)))
}

export interface Fit {
  readonly kept: readonly Item[]
  readonly dropped: readonly Item[]
  readonly tokens: number
}

/** Fits items into a token budget, keeping the most relevant and most precise context first. */
export function fit(items: readonly Item[], budget: number, limit = Number.POSITIVE_INFINITY): Fit {
  const ranked = preferSymbols(items)
    .map((item, index) => ({ item, index }))
    .toSorted(
      (left, right) =>
        (right.item.priority ?? 0) - (left.item.priority ?? 0) ||
        KIND_RANK[left.item.kind ?? "snippet"] - KIND_RANK[right.item.kind ?? "snippet"] ||
        left.index - right.index,
    )
  const kept: Item[] = []
  const dropped: Item[] = []
  let tokens = 0
  for (const { item } of ranked) {
    const cost = estimateTokens(item.text)
    if (kept.length >= limit) dropped.push(item)
    else if (tokens + cost <= budget) {
      kept.push(item)
      tokens += cost
    } else dropped.push(item)
  }
  return { kept, dropped, tokens }
}

export interface ConversationCall {
  readonly id: string
  readonly name: string
  readonly arguments: string
}

export interface ConversationMessage {
  readonly role: string
  readonly content: string
  /** Set on a tool result so it stays paired with the assistant call that produced it. */
  readonly toolCallId?: string
  /** Set on the assistant message that requested tools. */
  readonly toolCalls?: readonly ConversationCall[]
}

export interface Compacted {
  /** Older messages replaced by one deterministic summary line. */
  readonly summary?: string
  readonly kept: readonly ConversationMessage[]
  readonly tokens: number
}

/**
 * Keeps the newest messages that fit and replaces the rest with a short summary, so a small window still carries
 * what happened before without replaying every message.
 */
export function compactConversation(
  messages: readonly ConversationMessage[],
  budget: number,
  limit = Number.POSITIVE_INFINITY,
): Compacted {
  const newest: ConversationMessage[] = []
  let tokens = 0
  for (const message of [...messages].reverse()) {
    if (newest.length >= limit) break
    const cost = estimateTokens(message.content)
    if (tokens + cost > budget) break
    newest.unshift(message)
    tokens += cost
  }
  const kept = pairToolCalls(newest)
  const replaced = messages.slice(0, messages.length - kept.length)
  if (replaced.length === 0) return { kept, tokens }
  const counts = new Map<string, number>()
  for (const message of replaced) counts.set(message.role, (counts.get(message.role) ?? 0) + 1)
  const summary = `Earlier conversation compacted: ${replaced.length} message(s)${Array.from(
    counts,
    ([role, count]) => ` ${count} ${role}`,
  ).join(",")}.`
  return {
    summary,
    kept,
    tokens: kept.reduce((sum, message) => sum + estimateTokens(message.content), 0) + estimateTokens(summary),
  }
}

/**
 * Keeps tool results with the assistant call that produced them. Compaction can split the pair; OpenAI-compatible
 * endpoints reject a request where a tool result has no matching call or a call has no result, so an unpaired half is
 * dropped rather than sent.
 */
function pairToolCalls(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const responded = new Set(messages.flatMap((message) => (message.role === "tool" && message.toolCallId ? [message.toolCallId] : [])))
  const anchored = messages.flatMap((message) => {
    if (message.role === "tool") return [message]
    if (!message.toolCalls?.length) return [message]
    const calls = message.toolCalls.filter((call) => responded.has(call.id))
    if (calls.length === 0 && message.content.length === 0) return []
    return [{ ...message, toolCalls: calls }]
  })
  const calls = new Set(anchored.flatMap((message) => message.toolCalls?.map((call) => call.id) ?? []))
  return anchored.flatMap((message) =>
    message.role === "tool" && (!message.toolCallId || !calls.has(message.toolCallId)) ? [] : [message],
  )
}
