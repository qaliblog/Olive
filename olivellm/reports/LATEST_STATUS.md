# Latest status

Date: 2026-11-06. Branch: `addOliveLlm`. This file is the single authority on where the OliveLLM work stands. Older
reports under `reports/colab/` are historical measurements and are never rewritten.

## 1. Dataset — improved and verified this session

Five real-execution scenarios were added to `scripts/executed.js` and the whole pipeline was re-run from source:

```
node scripts/generate.js      # 479 generated
bun  scripts/executed.js      # real tool results
node scripts/validate.js      # 479/479 valid, 0 rejected
node scripts/deduplicate.js   # 3 duplicates removed
node scripts/split.js         # 309 / 54 / 57 / 56
node scripts/statistics.js
node scripts/export.js        # 415,360 / 71,078 / 82,211 / 75,037 tokens
```

| | Before | Now |
| --- | --- | --- |
| Validated records | 455 | 476 |
| Real-execution records | 79 | 100 |
| `done` / `blocked` text records | 27 / 7 | 35 / 5 |
| Persian / mixed | 89 / 7 | 94 / 14 |
| Real `run_tests` results in execution records | 4 passing / 13 failing, and the script-based fixtures could not run at all | 11 passing / 7 failing, all from processes that actually ran |

New scenarios: `question_missing_file` (asks a `QUESTION:` instead of inventing a missing changelog),
`resume_after_interrupt` (starts from a durable mid-run state and finishes it), `mixed_install_recovery` (missing npm
script, real retry, passing suite), `mixed_symbol_lookup` (Persian question answered from symbol index + search, no
edit), `persian_tests_recovery` (Persian failing-test loop).

**Defect found and fixed while validating:** every executed fixture declared `"test": "node --test test/"`, which on
Node 22.23.4 resolves the directory as a module path and fails before running a test. No execution record could ever
show a passing suite, and narration describing a pass contradicted the tool result beside it. Fixtures now name the
test file. An audit over all 100 execution records reports 0 result/narration mismatches, and no record has the literal
text `blocked` any more.

## 2. Tool selection — measured, not yet fixed

From `reports/colab/runs/2026-11-06-instruction-v4/raw/generations.jsonl` (71 frozen cases, corrected prompt):

- 13 cases emitted a tool call; 10 of the 65 tool-calling cases chose the expected tool.
- The 13 calls used only three tools: `inspect_diagnostics` (9), `run_shell` (3), `project_structure` (1) — the tools
  whose arguments are optional or a single string.
- Cases whose expected tool takes no required arguments: 7 correct out of 22. Cases whose expected tool takes at least
  one required argument: 3 correct out of 43.

So the model is not only under-calling; it collapses onto a small set of low-argument tools. Prompt-shape changes moved
this number from 0 to 13 calls and then stopped moving it (v2 0, v3 10, v4 13), which is why the next lever is
training, not another directive rewrite.

## 3. Verification run

| Check | Command | Result |
| --- | --- | --- |
| Dataset validator | `node scripts/validate.js` | 479/479, 0 rejected, exit 0 |
| Split leakage | `datasets/processed/split-manifest.json` + `test/split-groups.test.js` | 0 overlapping groups/records |
| olivellm tests | `bun test` from `olivellm` | 37 pass, 0 fail |
| Core Olive tests | `bun test test/olive-*.test.ts` from `packages/core` | 84 pass, 0 fail |

The full `packages/core` suite (6,885 tests) reports 43 failures and 2 errors in this sandbox; none of them are in
`test/olive-*`, and this session changed no file under `packages/core`. They are pre-existing environment failures
(lock/permission style) and are reported as such rather than as passes.

## 4. Next

1. Controlled LoRA on `olive-lfm-gpu`: rank 16, alpha 32, dropout 0.05, seq 1024, lr 2e-4, 3 epochs, assistant-only
   loss, targets `q_proj,k_proj,v_proj,w1,w2,w3,re:.*self_attn\.out_proj$`.
2. Re-measure the base checkpoint on the **new** held-out suite before comparing: the held-out set changed, so the
   published v4 numbers are no longer a valid baseline.
3. Base vs fine-tuned on the same 71 cases and the same directive, then the five agent scenarios.

## 5. Open decision

The measured v4 instruction (13/71 calls) is kept, not widened: adding prompt text produced no gain and there is
already evidence that argument-bearing tools are the failure point. Training now, on the corpus above, is the next
experiment.
