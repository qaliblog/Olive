# OliveLLM architecture audit

Audit date: 2026-11-05. Branch: `addOliveLlm`. Scope: the Olive-native agent engine, not the older
session/server stack. Everything below was read from the working tree, not inferred from documentation.

## What the agent actually is

`packages/core/src/olive/` is a self-contained engine with no dependency on the background server, the
session/tool registry, or the inherited provider catalog:

| Module | Responsibility | Depends on |
| --- | --- | --- |
| `provider.ts` | Provider document parsing, credential resolution, OpenAI-compatible and Ollama wire adapters, diagnostics | nothing local |
| `model.ts` | Descriptor (`context`, `maxOutput`, `tools`, `json`, `tokenizer`) and `provider/model` resolution | `provider.ts` |
| `context-budget.ts` | Token allocation, item fitting, conversation compaction | nothing local |
| `prompt.ts` | The system prompt and the single user step message | budget, task state, provider types |
| `task-state.ts` | Durable `.olive/task.json`, atomic write, summary rendering | nothing local |
| `tools.ts` | The 11 tools, workspace containment, symbol index, command execution | nothing local |
| `agent.ts` | The step loop, task-state folding, completion | all of the above |

The CLI surface is one command (`packages/cli/src/commands/handlers/agent.ts`):

```
olive agent [--directory <path>] [--model provider/model] [--max-steps N] [--continue] <objective...>
```

`--continue` loads `.olive/task.json` and reuses its objective when no objective is given. The command exits
non-zero when the outcome is not completed, so an automation wrapper can detect an unfinished task.

The runtime dependency direction required by the repository (`Schema -> Core/Protocol -> Server`) is not
affected by this package: `olive/` imports only `effect` and Node/Bun builtins.

## Data flow of one step

1. `OliveModel.resolve(registry, requested)` picks a provider and model, or returns a `ProviderDiagnostic`.
2. `OliveModel.adapter` builds the wire adapter. `gguf` and `olive-native` are refused with
   `unsupported-runtime`; only `openai-compatible`, `ollama`, and `llama-cpp` (through the OpenAI-compatible
   protocol) can run today.
3. `OliveAgent.ask` computes a budget from the **declared** context and max output, retrieves symbols for the
   files the task touched, builds one system message plus one user step message, and streams the response.
4. On `context-overflow` the request is retried once with a smaller code allocation. No other error is retried.
5. Text and tool calls are collected. At most two calls per step are executed; the rest are dropped before
   the assistant turn is recorded (see D1).
6. Each call is parsed, executed by `OliveTools.execute`, and folded into the task state by
   `progress`. A failure produces an `errors` entry and a `next` hint, never a completed step.
7. The final message in a step carries no tool calls: the agent returns its text as the answer and reports
   whether the task completed.

## Audit findings and defects

Severity is about how badly the defect corrupts training data or agent behaviour, not code style.

### D1 - Tool results were never sent back, and skipped calls were recorded (critical, fixed)

The loop appended the assistant turn with **all** requested calls, executed at most two, and pushed no
`tool` message. An OpenAI-compatible endpoint validates that every assistant `tool_calls` entry is followed
by a matching tool result, so the second request of any tool-using task could be rejected with HTTP 400. The
model would also see assistant turns asking for operations that never ran.

Fix: the assistant turn now records only the executed calls, and each execution appends a `tool` message
with the matching `toolCallId` and the real result text.

### D2 - Compaction could orphan a tool result (high, fixed)

`compactConversation` kept the newest messages by budget and could keep a tool result whose assistant call
was dropped, or drop a result whose call was kept. Either half alone is an invalid request. `pairToolCalls`
now keeps only call ids that have a kept result, drops assistant call entries without results, and drops
orphaned results.

### D3 - Diagnostics marked the test-verification step complete (high, fixed)

`progress` treated `inspect_diagnostics` and `run_tests` as one event: either tool completed both
`run diagnostics` and `verify the result`, and the `verification` list was replaced rather than appended.
`edit_file` also completed `fix errors` unconditionally, even with no error recorded.

Fix: each tool completes only its own step, verification entries accumulate, `fix errors` is recorded only
when diagnostics or tests pass after errors were stored, and outstanding errors are cleared by that pass
(the outcome still reports the historical `failures`).

### D4 - Completion was reported without any operation (medium, fixed)

Any final message with no recorded failures returned `completed: true`, including a model that answered
immediately and did nothing. `completed` now also requires at least one successful operation, and the
outcome carries an explicit error for the no-work case.

### D5 - Malformed tool arguments reached the tool as a raw string (medium, fixed)

`decodeArguments` returned an `Option`; on failure the raw string was passed to the tool, producing a
"expects { path, content }" message that hid the real problem (unparseable JSON). An empty argument string,
which some models emit for no-argument calls, also failed. The agent now normalises empty to `{}` and
reports `invalid-arguments` with the offending text without executing the tool.

### D6 - Every transition wrote the state file twice (low, fixed)

`task = await state.write(...)` was followed by a second `state.write(task)` in three branches: two atomic
writes per transition, one of them redundant.

### D7 - Non-Latin text was under-counted by the budget heuristic (high for Persian, fixed)

`estimateTokens` used `chars / 4` for every script. Persian and Arabic tokenize at roughly one to two
characters per token, so the agent would build prompts it believed fit and that overflow the window. Non-ASCII
code points now count three quarter-units instead of one; ASCII estimates are unchanged.

### D8 - Symlinked paths can escape the workspace (file safety, **not fixed**)

`resolve` compares resolved paths but does not call `realpath`, so a symlink inside the project can point
outside it. Fixing this correctly needs an async `realpath` of the nearest existing parent in every tool,
and changes error timing. It is documented as a limitation instead of being changed silently; see
`documentation/dataset_specification.md` for how the dataset avoids teaching the unsafe path.

### D9 - `run_tests` and `inspect_diagnostics` default to `bun run` (limitation)

`install_dependencies` detects npm/pnpm/yarn from the lockfile, but the other two default to Bun. Olive
itself is Bun-based, and the dataset teaches explicit `command` arguments for npm projects. No change made.

### D10 - `write_file` replaces an existing file without warning (design)

The tool is intentionally a full write; safety comes from the system prompt ("inspect before editing") and
from the dataset, which includes examples where the correct decision is `read_file`/`search_code` first. A
pre-write existence check would add a round trip and was not requested.

## What was verified

- `packages/core`: `bun run script/test.ts test/olive-*.test.ts` - 39 tests pass after the fixes.
- `packages/core`: `bun typecheck` - no type errors.
- The regression tests are named in `OLIVELLM_TODO.txt` next to each defect.

## What the audit did not cover

- The TUI, session server, plugin system, and SDK are outside the Olive agent path and were not inspected.
- No live model endpoint was available, so no end-to-end agent run against a real LFM2.5 server was
  performed. Every behavioural claim above comes from the code and from the in-process HTTP fixtures.
- GGUF/LoRA deployment, Persian quality, and multi-step reliability are untested; see `model_findings.md`.
