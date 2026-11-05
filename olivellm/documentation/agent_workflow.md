# Olive agent workflow, as implemented

This is the behaviour the dataset must teach. Every statement maps to `packages/core/src/olive/` on
`addOliveLlm` after the audit fixes. Where the code does not do something, that is stated instead of the
capability being invented.

## 1. How the agent receives an objective

`OliveAgent.run({ objective, directory, registry, state, ... })`. The CLI joins the variadic argument with
spaces, or reuses the saved objective with `--continue`. There is no conversation: the objective is a single
string, persisted as `objective` in `.olive/task.json`.

## 2. How requirements are interpreted

They are not interpreted by code. The model reads the objective and the task state; the initial plan is the
fixed `WORKFLOW` list (`agent.ts`):

```
analyze requirements -> write an implementation plan -> create project directories ->
write initial files -> implement remaining files -> install dependencies ->
run diagnostics -> fix errors -> verify the result
```

The model narrows this by choosing the first tool, not by writing a new plan. `initialize` seeds `plan` and
`remaining` with the whole list when the objective is new or the saved plan is empty.

## 3. How task plans are maintained

`task.plan` is the fixed workflow; `task.completed` and `task.remaining` are derived by `advance`, which
recomputes `remaining = plan - completed` after every fold. `next` is a model-facing hint, not a state
machine. The state is the source of truth; the conversation is a cache.

## 4. How context is constructed

One request per step, `OlivePrompt.build`:

```
system: Olive's short rule list ("inspect before editing", "one file per write", "never claim success",
        and the 11 tool names)
summary (optional): "Earlier conversation compacted: N message(s) ..."
kept conversation: newest messages that fit the conversation budget, tool calls paired with results
user: "Task state:" + OliveTaskState.summarize(task)
      "Relevant code:"  symbol summaries and matching symbol bodies from the last 5 task files
      "Recent tool results:" newest results, each truncated
```

The budget comes from the declared `context` and `maxOutput` of the configured model; there is no assumed
32K or 128K window. Default shares: system 0.15, task 0.15, code 0.35, conversation 0.15, tool results 0.1,
generation 0.1.

## 5. How model requests are sent

`OliveModel.adapter` picks the protocol from the provider document. `openai-compatible`/`llama-cpp` stream
SSE chat completions; `ollama` streams NDJSON `/api/chat`. Tool definitions are sent only when the model
declares `tools: true`. JSON mode is sent only when the model declares `json: true`. Tool arguments are
returned to Olive as a JSON **string**; the agent parses them.

## 6. How tool calls are received

The adapter accumulates streamed deltas per call index. Tool calls are yielded after the stream terminates
(OpenAI) or per line (Ollama). The agent keeps at most two calls per step.

## 7. How tool arguments are validated

Two layers:

- The agent parses the argument string as JSON. Unparseable input is reported as `invalid-arguments`
  without executing anything; an empty string is treated as `{}`.
- Each tool decodes its own Effect schema with `onExcessProperty: "error"`, so wrong types, missing required
  fields, and unknown fields all fail as `invalid-arguments` with the expected shape.

## 8. How tools are executed

`OliveTools.execute(name, input, context)` where `context` carries the workspace root, an optional abort
signal, and `maxOutputChars = 4000` for the agent. Paths are resolved against the root and rejected when
they escape it. Command tools run `bash -lc` with the workspace as cwd and a timeout.

## 9. How tool results are returned to the model

Two places, and both matter:

- Durable: folded into `.olive/task.json` (`files`, `symbols`, `errors`, `completed`, `verification`,
  `next`).
- Prompt: `Recent tool results:` in the next step message, newest first, compressed to fit.
- Wire: one `tool` message per executed call with the matching `toolCallId`, so the endpoint sees a valid
  tool turn. This was missing before the audit fix.

A failure is always rendered as `"{tool} failed ({code})\n{message}"`; a success as `"{tool} ok\n{output}"`.
The model never receives a success for an operation that failed.

## 10. How errors are handled

- Provider errors become `ProviderDiagnostic` with a code (`missing-provider`, `invalid-endpoint`,
  `unauthorized`, `context-overflow`, `unsupported-tools`, `timeout`, ...). The agent records the code in
  `errors`, sets `next = "resolve the provider error before continuing"`, emits an `error` event, and
  returns `completed: false`.
- `context-overflow` is the only retried failure: one retry with `code: 0.15, conversation: 0.1`.
- Tool failures are never retried automatically; the state stores the error and a per-tool retry hint
  (`write_file -> fix the failed write and continue`, `edit_file -> re-read the file and retry the edit`,
  `run_tests -> fix the failing tests`, ...).
- A thrown non-provider error aborts the run; the state file still holds the last successful transition.

## 11. How task state is persisted

`.olive/task.json`, written through `file.<uuid>.tmp` and `rename`, so an interrupted write cannot leave a
half file. The state is written after initialisation, after every tool result, and before returning.
Shape (`task-state.ts`): `objective`, `project?`, `plan`, `completed`, `remaining`, `files`, `symbols`,
`pending`, `verification`, `errors`, `next?`, `updated`.

## 12. How the agent resumes interrupted work

`--continue` reads the state. If the objective matches and the plan is non-empty, the state is kept as is
and the loop starts again with `history` and `toolResults` empty. Files on disk are the only memory of
previous operations besides the state lists. If the objective differs, or the plan is empty, the workflow is
re-seeded and the previous `completed` list is not trusted for the new objective.

Consequence for the dataset: a resumption example must show the model re-reading the file it was editing,
because the conversation and tool results were lost; only `task.files` / `task.next` / `task.errors`
survived.

## 13. How completion is determined

The step returns when the model produces a message with no tool calls. After the audit fix:

```
completed = no tool failure in the run AND at least one tool operation succeeded
```

Otherwise the outcome is `completed: false` with either the failure list or an explicit
`"the model stopped before it performed any tool operation"` error. Verification (`run_tests` passing) is
recorded in `task.verification` and is required by the dataset's completion examples, but the agent itself
does not block completion on it: a model that stops early is reported as incomplete, not prevented.

The step limit (default 12) ends the run with `completed: false`, a step-limit error in the state, and
`next = "review the remaining work"`; the task is resumable.

## 14. What the agent does not do

- No plan rewriting, no sub-agents, no parallel tools, no in-memory tool loop.
- No file-content memory across steps except symbol retrieval from `task.files`.
- No diff review, no git operations, no sandboxing beyond path containment (see D8: symlinks are not
  resolved).
- No verification gate: an untested task can still be reported as completed if a tool succeeded.

## 15. Where the training data must line up

| Workflow fact | Dataset invariant |
| --- | --- |
| one step, one call batch, max two calls | every example's `expected_tool_calls` has 1..2 entries |
| the assistant turn records only executed calls | `expected_tool_calls` and `expected_tool_results` have equal length when results exist |
| failures are never success | a failure result forbids a success claim in `expected_response` |
| verification comes from tests or diagnostics | a `verify` step is only claimed with a passing result |
| state folds deterministically | `expected_task_state` is re-derived by `validate.js` from the call and result |
| resumption loses the conversation | resumption examples carry `context.conversation = []` and a populated `task_state` |
