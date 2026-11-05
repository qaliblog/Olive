# OliveLLM dataset specification

One record is one supervised step of the Olive agent: what the model sees, what the executor does, and what the agent
should say next. The dataset mirrors `packages/core/src/olive/*` rather than describing an idealised agent, so a record
that the runtime would not produce is a validation failure, not a stylistic difference.

## Files

| Path | Contents |
| --- | --- |
| `datasets/raw/examples.jsonl` | Template-generated records (`source.kind = "template"`) |
| `datasets/raw/executed.jsonl` | Records from real tool execution (`source.kind = "execution"`) |
| `datasets/raw/executed-summary.json` | Scenario list, per-tool counts, and the note that results came from the executor |
| `datasets/validated/validated.jsonl` | Records that passed every check |
| `datasets/validated/deduplicated.jsonl` | Validated set after exact and near-duplicate removal |
| `datasets/rejected/rejected.jsonl` | Rejected records with every reason and the source line |
| `datasets/rejected/rejected-duplicates.jsonl` | Duplicates with the record they duplicate |
| `datasets/processed/{train,validation,test,heldout}.jsonl` | Group-based splits |
| `datasets/processed/sft-*.jsonl` | LFM2.5 chat records (`messages`, `tools`, `text`, `target`, `tokens`) |
| `datasets/processed/split-manifest.json` | Split counts, group counts, per-category matrix, leakage check |
| `datasets/processed/export-manifest.json` | Rendered token counts, tool list, preference/held-out counts |
| `datasets/preference/preferences.jsonl` | Chosen/rejected pairs for preference training |
| `evaluation/{tool_calling,coding,multilingual,baseline}/cases.jsonl` | Frozen evaluation cases from held-out groups |
| `evaluation/heldout/ids.json` | Frozen held-out ids |

## Record schema

`schema/example.schema.json` is authoritative; `scripts/lib/schema.js` validates it without adding a dependency.

```jsonc
{
  "id": "olive.file_editing.react_login.en.0007",   // olive.<category>.<slug>.<language>.<counter>
  "version": "1.0.0",
  "category": "file_editing",                        // 15 categories, see below
  "language": "en",                                  // en | fa | mixed
  "difficulty": "easy",                              // easy | medium | hard
  "objective": "fix the argument index in src/cli.js",
  "system": "...",                                   // verbatim OlivePrompt.SYSTEM
  "context": {
    "task_state": { /* task_state.schema.json, or null */ },
    "conversation": [ /* up to 8 prior messages */ ],
    "code": [ { "file": "src/cli.js", "text": "...", "kind": "symbol" } ],
    "tool_results": [ "read_file ok\n..." ],
    "workspace": [ ".", "src/", "src/cli.js" ]
  },
  "expected_plan": ["analyze requirements", "..."],
  "expected_tool_calls": [ { "name": "edit_file", "arguments": { }, "why": "..." } ],
  "expected_tool_results": [ { "index": 0, "tool": "edit_file", "ok": true, "output": "edited src/cli.js", "files": ["src/cli.js"] } ],
  "expected_task_state": { /* the fold of the results over context.task_state */ },
  "expected_response": { "kind": "tool_call", "text": "...", "completion": "continue" },
  "validation": { "status": "passed", "checks": ["schema", "..."], "notes": "", "commands": ["..."] },
  "source": { "kind": "execution", "generator": "executed.node_cli_verify", "seed": 0, "trajectory": "node_cli_verify" },
  "split": "train"
}
```

### Tool-call format

`schemas/tool_call.schema.json` mirrors `packages/core/src/olive/tools.ts`. The `name` enum, each tool's `parameters`,
its `required` list, `additionalProperties: false`, every `minLength`/`minimum` and every description are compared with
the runtime definitions by `olivellm/test/tool-parity.test.js`, which also probes the real executor: an argument object
the schema accepts must not come back as `invalid-arguments`, and one it rejects must.

The wire format the model must emit is the LFM2.5 native call block:

```
<|tool_call_start|>[read_file(path='src/server.js', start=1, end=40)]<|tool_call_end|>
```

String values are single-quoted with `\`, `'`, `\n`, `\r` escaped; numbers, `True`, `False`, `None` are bare; mappings
and lists are JSON. This is exactly what `tokenizer.apply_chat_template` produces, so training targets and inference
prompts use one format.

### Task-state format

`schemas/task_state.schema.json` mirrors `OliveTaskState.TaskState`: `objective`, optional `project`, and the arrays
`plan`, `completed`, `remaining`, `files`, `symbols`, `pending`, `verification`, `errors`, optional `next`, `updated`.
`plan` and `completed` may only contain the nine `OliveAgent.WORKFLOW` steps, `remaining` must be `plan` minus
`completed`, and `verification` may only contain `inspect_diagnostics passed` or `run_tests passed`. `updated` is a
fixed epoch plus the record index so regeneration is byte-stable.

## Source provenance

`source.kind` separates how a record was produced:

- `template`: generated from the project archetypes in `scripts/lib/projects.js` and snippets in `scripts/lib/snippets.js`.
- `execution`: produced by `scripts/executed.js`, which seeds a temporary fixture workspace and runs every step through
  the real `OliveTools.execute`. The recorded output is the executor's output, failures included. Fixture files are
  seeded directly and never counted as verified work.
- `handwritten` / `teacher` are accepted by the schema and currently unused.

`source.trajectory` names the scenario, so every step of one run is identifiable and kept in one split.

## Validation rules

`node olivellm/scripts/validate.js` (exit code 1 on any rejection, on an unreadable corpus, or on an unexpected error):

1. **Schema** — the full example schema, including cross-file `$ref` to the task-state and tool-call schemas.
2. **Id** — must start with the category and end with the language and a four-digit counter.
3. **Catalog** — every call names a known tool and satisfies that tool's argument schema. A record that demonstrates
   argument rejection must actually fail with `invalid-arguments`.
4. **Pairing** — results are zero-length or exactly as long as the calls and name the same tool, in order.
5. **Completion coherence** — `kind: tool_call` requires a call; `completion: continue` requires a call; `done` and
   `blocked` never carry a call.
6. **Task-state invariants** — no repeated or unknown plan steps, `remaining` derived from `plan`/`completed`,
   verification entries backed by the matching completed step, no duplicate files.
7. **Task-state fold** — `expected_task_state` must equal `progress(...)` folded over the expected results. A generator
   cannot invent a state the agent would not persist.
8. **Paths** — no absolute paths and no `..` except in a deliberate `outside-workspace` failure; reads and edits must
   target workspace files; directory tools must target workspace directories.
9. **Tool outputs** — `write_file` must report `wrote <path> (<bytes> bytes)` with the real byte count and track the
   file; `edit_file` must report `edited <path>`; `read_file` output must match the corpus when the path is in it;
   command tools must include `(exit code 0)` on success.
10. **Honesty** — `done` is refused after a failed result, while errors remain in the state, without any successful
    operation, or when files were produced without `run_tests passed`. A `done` after a file change in the same step
    also requires the test to have run afterwards. Inspection-only tasks may stop without tests, matching the runtime.
11. **Language** — `fa` requires at least 15% Persian characters, `en` at most 5%, `mixed` between 5% and 85%, code
    fences excluded from the ratio.
12. **Length** — at most 3200 estimated tokens, with a warning note above 2048.
13. **Code** — every `write_file` payload and fenced block is parsed: JavaScript and TypeScript with the Bun/TS parser,
    Python with `py_compile`, HTML by tag balance, CSS by brace balance.
14. **Duplicates** — identical objective within a category (template records only; trajectory steps legitimately share
    one) and an identical record fingerprint.

## Deduplication

`scripts/deduplicate.js` removes a record when its tool calls, tool results and answer match an earlier one exactly, or
when word-five-shingle Jaccard similarity with an earlier record in the same category is at least 0.9. Every removal is
written to `datasets/rejected/rejected-duplicates.jsonl` with the record it duplicates. Current run: 4 removed of 459.

## Group-based splitting

`scripts/split.js` groups records by `(project, generator family, trajectory, language)` — 171 groups — ranks groups by
`sha1(groupKey)`, and assigns each whole group to the split furthest below its target share (held-out 9%, test 8%,
validation 8%, train 75%). Categories with at least six records are then guaranteed a whole group in validation, test
and held-out by moving a training group, never by splitting one. The manifest records the check: zero groups and zero
records appear in more than one split. `olivellm/test/split-groups.test.js` re-derives the assignment and asserts the
same invariants.

This replaced id-level splitting, which put sibling records of one project/template family on both sides of the
boundary.

## Language distribution

359 English, 89 Persian, 7 mixed. Persian records use Persian objectives and explanations with English identifiers,
paths and command output, which is what a Persian developer writes. Mixed records interleave Persian instructions with
English tool names, error messages and code.

## Evaluation isolation

Held-out groups (57 records) are frozen in `evaluation/heldout/ids.json` and are excluded from train, validation and
test by construction. The evaluation cases are derived only from those records, so no evaluation prompt has a sibling
in training. `evaluation/colab/cases.jsonl` is a deterministic subsample (even stride over sorted ids, capped per suite)
of the same frozen set, and the baseline run's conditions are recorded in `reports/colab/baseline_metrics.json`.
