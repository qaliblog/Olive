# Adding Olive (LFM2.5-350M) as a native model provider

Status: proposal. No provider code was changed. It is based on the measured results in
`reports/lfm2.5-350m/REPORT.md` and the existing engine read in `documentation/architecture.md`.

## The shortest correct path needs no new provider type

`OliveProvider` already speaks the OpenAI chat-completions protocol, streams SSE, sends tool definitions, and parses
streamed `tool_calls` with arguments as a JSON string. `OliveModel.adapter` already refuses `gguf` and `olive-native`
with `unsupported-runtime` instead of pretending.

LFM2.5 has first-class serving support in exactly that protocol:

- `llama-server` with `--jinja` renders the model's own chat template, including the tool list, and returns OpenAI
  `tool_calls`.
- vLLM with `--enable-auto-tool-choice --tool-call-parser lfm2` does the same.

So the smallest reliable integration is a **configuration document**, not code:

```json
{
  "providers": {
    "olive": {
      "id": "olive",
      "name": "Olive (local LFM2.5)",
      "type": "openai-compatible",
      "baseURL": "http://127.0.0.1:8080/v1",
      "local": true,
      "timeoutMs": 60000,
      "models": [
        {
          "id": "olive-lfm2.5-350m",
          "context": 8192,
          "maxOutput": 512,
          "tools": true,
          "json": false,
          "tokenizer": "LiquidAI/LFM2.5-350M"
        }
      ]
    }
  },
  "default": { "provider": "olive", "model": "olive-lfm2.5-350m" }
}
```

Three values in that document are measured, not guessed:

| Field | Value | Why |
| --- | --- | --- |
| `context` | 8192 | A 32,768-token prompt raises `OutOfMemoryError` on a 16 GB T4; 8,192 peaks at 11.2 GB and works |
| `maxOutput` | 512 | The model's own tool calls are 7-25 tokens; Olive's step answers are short |
| `json` | false | JSON mode is not a declared capability; structured output must come from the prompt |

Anything local that speaks the same protocol (llama.cpp, vLLM, LM Studio, a future Olive server) drops in by changing
`baseURL`. No new adapter, no new dependency, and the existing `ollama` path covers Ollama users.

### When `olive-native` should be implemented

Only when Olive ships a bundled runtime it controls. Until then an `olive-native` provider would either duplicate
`llama-server` or require a C++/Rust inference dependency inside Core, which the repository's dependency direction
(`Schema -> Core/Protocol -> Server`) does not currently allow for and which buys nothing the OpenAI protocol does not
already provide. Leaving the type declared and refused is the honest state.

## Two defects that must be fixed first, and they are in Olive, not in the model

Both were measured, not inferred. They are recorded here because the integration is worthless until they are fixed.

### D11 - the step message contains no instruction (blocking)

`OlivePrompt.build` sends exactly one user message: `Task state:` + `Relevant code:` + `Recent tool results:`. There
is no sentence asking for an action. On 8 frozen cases the base model answered that block with status prose
("The task requires a detailed plan with specific actions…") and produced **0 tool calls in 40 of 40 ablations** -
including with the system message removed, the tool list trimmed to one, or the system prompt replaced.

Adding one imperative line at the end of the step message changes the outcome measurably:

| Step message | Cases producing a call (of 8) |
| --- | --- |
| As implemented today | 0 |
| `+ "Decide the single next action … call the tool that performs it now."` | 0 |
| `+ "Call one tool now. Reply with the tool call only."` | **6** |

This explains the two results the previous report left as model failures: the 0/65 tool-call baseline and the 0/5
agent scenarios. The checkpoint can call tools; Olive never asked it to.

Smallest fix: append a fixed directive line to the step message in `prompt.ts`, ending with the current `task.next`
value, for example:

```
Next: call one tool now for "<task.next>". Reply with the tool call only.
```

6 of 8 is still a base-model limitation - the other 3 need fine-tuning - but 0 to 6 is the difference between an agent
that works and one that cannot act.

### D12 - the call parser rejects the model's own quoting (fixed)

The model emits `[list_directory(path="src")]`; the chat template renders `path='src'`. `lfm2-parse.js` accepted only
single quotes, so a genuine call parsed as `{calls: [], invalid: true}`. Any evaluation or agent run that scores the
model's real output lower than it is was wrong because of this, not because of the model.

Fix applied in this run: `parseValue` accepts either quote style and unescapes `\\`, `\n`, `\r` and the quote itself in
a single pass. Covered by `olivellm/test/lfm2-parse.test.js`.

## What the model should decide, and what must stay deterministic

The card says the model is "not recommended for … programming", and the measurements agree: it writes a good small
function but its factual answers are unreliable (`npm ci` described as "automates the installation of dependencies").

For a 350M model driving a coding agent, the split that the evidence supports:

| Decision | Owner | Reason |
| --- | --- | --- |
| Which tool to call next | Model | Measured: correct tool on 4 of 8 cases once asked |
| Which file path to read | Model | Correct in the measured probe |
| Boilerplate file contents (persian: package.json, configs, test skeletons) | Template | Deterministic, and the model adds no value |
| Business logic inside a file | Model, small units | It produces good single functions; weak on wiring |
| Command to install dependencies | Model picks tool, template supplies command | `install_dependencies` already detects the package manager |
| Whether the task is done | Executor record | `completion()` already refuses unverified success |
| Long file content in one call | Neither at this size | Argument fidelity over ~200 tokens is the known limit |

## Request/response contract the integration relies on

Already implemented and verified in the code path:

- Streaming: SSE `data:` lines, `[DONE]` terminator; tool calls accumulated per index and yielded after the stream.
- Tool arguments: JSON **string** on the wire, parsed by `OliveAgent.perform`; a parse failure becomes
  `invalid-arguments` without executing anything.
- Tool pairing: every executed call gets a `tool` message with its `toolCallId` (audit finding D1).
- Budget: `context` and `maxOutput` come from the document; nothing assumes 32K.
- Errors: `context-overflow`, `unsupported-tools`, `unauthorized` and friends are diagnostic codes already; a
  fine-tuned model that rambles will surface as `context-overflow` and get one retry with a smaller budget.

## Verification a provider change must pass

1. `bun run script/test.ts test/olive-*.test.ts` in `packages/core` (existing provider fixtures).
2. `bun typecheck` in `packages/core`.
3. One real `olive agent` run against the local server with the directive fix, expecting at least one executed tool
   call and a non-zero exit only when the objective is genuinely incomplete.
4. Re-run the frozen 71 cases through the same server and compare against
   `reports/colab/raw/generations-2026-11-06.json` before claiming any improvement.
