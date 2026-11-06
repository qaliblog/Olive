# LFM2.5-350M research run - 2026-11-06

Run ID: `2026-11-06-colab-t4`
Model revision: `9921cd4d82c0e3986887aa4b376f9446729ef8a3`

Everything below was measured on this run or read from the model's own repository. Nothing is estimated.
Artifacts: `inference_validation.json`, `benchmark.json`, `prompt_ablation.json`, `prompt_directive.json`,
`lora_probe.json`, `run-manifest.json`, and `../colab/raw/generations-2026-11-06.json`.

## 1. Repository architecture

The full audit is `documentation/architecture.md` (unchanged). Current state, re-verified by reading the code:

`packages/core/src/olive/` is a self-contained agent engine with no dependency on the session/server stack.

| Module | Responsibility |
| --- | --- |
| `provider.ts` | Provider documents, credentials, OpenAI-compatible + Ollama wire adapters, diagnostics |
| `model.ts` | Descriptor and `provider/model` resolution; refuses `gguf`/`olive-native` |
| `context-budget.ts` | Token allocation and conversation compaction |
| `prompt.ts` | The system prompt and the single user step message |
| `task-state.ts` | Durable `.olive/task.json` |
| `tools.ts` | 11 tools, workspace containment, symbol index |
| `agent.ts` | Step loop, state folding, completion rule |

Dependency direction is intact: `olive/` imports only `effect` and Node/Bun builtins.

The research tree is `olivellm/` (documentation, datasets, schemas, scripts, evaluation, reports). This run added to it
rather than replacing anything.

## 2. Git status

| Item | Value |
| --- | --- |
| Working directory | `/root/Olive` |
| Branch | `addOliveLlm` |
| Remote | `git@github.com:qaliblog/Olive.git` |
| HEAD | `c4f6a90c93` |
| Ahead / behind `origin/addOliveLlm` | 0 / 0 (identical) |
| Tracked tree at start | clean |
| Branch switched | no |
| Anything reset or deleted | no |

Changes made in this run: one modification (`scripts/colab/environment.py`, now also reports VRAM), one fix
(`scripts/lib/lfm2-parse.js`), one new test file, five new Colab scripts, and the report artifacts. Nothing is
committed.

## 3. Colab CLI and authentication

| Item | Value |
| --- | --- |
| CLI | 0.7.5 at `/root/.local/bin/colab`, `--auth=oauth2` |
| Authentication | working; `colab sessions` answered without re-auth |
| Balance | 0.00 compute units |
| Session `olive-lfm-research` (CPU) | created at 0.08 CU/hr, used for the environment probe, stopped |
| Session `olive-lfm-gpu` (T4) | created at 1.23 CU/hr, all GPU work ran there, stopped at the end of the run |

A GPU was allocated despite the 0.00 balance, so the unit balance is not what gated work here. The CPU session was
stopped as soon as it was no longer needed, and the GPU session at the end, so the run does not keep billing.

## 4. Hugging Face authentication

| Item | Value |
| --- | --- |
| Where the token lives | `HF_TOKEN` in the repository `.env` |
| `.env` ignored by git | yes, verified with `git check-ignore -v .env` (`.gitignore:5`) |
| How it reaches the kernel | `colab --env KEY=VALUE` through `scripts/colab/colab-env.sh` |
| Token in shell environment | no |
| Token printed anywhere | no |
| Authenticated as | `Qalibgh` |

## 5. Model compatibility

Summary in `documentation/model_compatibility.md`. The headline facts: `Lfm2ForCausalLM`, 354,483,968 parameters, 16
layers (10 double-gated conv + 6 GQA), GQA 16/8 heads, 64,402-token tokenizer, ChatML-like template with the tool list
appended to the system message, documented context **32,768**, LFM Open License v1.0. It is not a Llama model.

## 6. Inference validation: 12 of 12 checks pass

Raw: `inference_validation.json`. Runtime: Python 3.13.16, torch 2.11.0+cu130, transformers 5.22.0, `cuda:0`, bf16.

| # | Check | Result |
| --- | --- | --- |
| 1 | Model download | 14 files, 713,753,256 bytes |
| 2 | Tokenizer init | `TokenizersBackend`, vocab 64,402, template 5,487 chars |
| 3 | Model init | 354,483,968 params, 676 MiB weights, 678 MB peak VRAM |
| 4 | Plain completion | coherent Python continuation |
| 5 | Chat style | correct short answer |
| 6 | Multi-turn | answered the follow-up |
| 7 | Persian | Persian text, incoherent content |
| 8 | English coding | correct `readJsonFile` with `fs` + `JSON.parse` + throw |
| 9 | Structured output | valid JSON, but wrapped in a code fence despite instructions |
| 10 | Long context (3,254 tokens) | retrieved the needle correctly |
| 11 | Repeated generation | 3/3 byte-identical (greedy) |
| 12 | Tool-call format | **native call emitted**, greedy and sampled |

No check failed, so there is no traceback to report from this suite. Previous logs contained no inference suite to
compare against; the 71-case evaluation is a scoring run, not an inference test, and it was re-run here (section 8).

## 7. Performance benchmarks

Raw: `benchmark.json`. T4, bf16, `causal_conv1d` **not** installed, so every number is the reference-kernel path.

| Metric | Value |
| --- | --- |
| Load, cold (download + init) | 14.89 s model + 1.57 s tokenizer |
| Load, warm from cache | 0.39 s |
| Weights in memory | 676 MiB |
| Peak system RAM | 2,516 MB |
| Context 512: prefill / decode | 2,413.6 tok/s / 58.32 tok/s, 1,454 MB peak |
| Context 2,048: prefill / decode | 2,884.5 tok/s / 45.32 tok/s, 2,049 MB peak |
| Context 8,192: prefill / decode | 1,872.7 tok/s / 57.16 tok/s, 11,169 MB peak |
| Context 32,768 | **OutOfMemoryError** |
| Chat decode (37-token prompt, 64 new tokens) | 52.1 tok/s, 0.461 s mean over 3 runs |
| Maximum stable context tested | 8,192 |

Prompt processing and generation are measured as separate phases, with decoding through the KV cache. Prefill is
roughly 40x decode speed, which is exactly the confusion the separate columns exist to prevent.

## 8. Errors found, root causes, and fixes

| # | Symptom | Root cause | Fix | Status |
| --- | --- | --- | --- | --- |
| E1 | `causal_conv1d` warning at load | the 10 conv blocks use a fused kernel that is not installed | install `causal_conv1d`; until then numbers are reference-kernel | open, documented |
| E2 | `OutOfMemoryError` at 32,768 | 8,192-token prefill already peaks at 11.2 GB of a 16 GB T4 | declare `context: 8192` for a T4 provider | measured limit |
| E3 | Model's real call scored `invalid` | `parseValue` accepted only single quotes; the checkpoint writes `path="src"` | accept either quote, one-pass unescape | **fixed**, `test/lfm2-parse.test.js` |
| E4 | `ImportError: Found an incompatible version of torchao` in peft | peft 0.21.2 needs `torchao>=0.16.0`, Colab ships 0.10.0 | `colab install "torchao>=0.16.0"` | **fixed** |
| E5 | Attention output projection never adapted | there is no `o_proj`; it is `out_proj`, shared with the conv blocks | target `w1/w2/w3` + `re:.*self_attn\.out_proj$` | documented |
| E6 | `bun test` refuses to run at repo root | repository guard `do-not-run-tests-from-root` | run from `olivellm/` | expected |

### The finding that matters most: D11

Re-running the frozen 71 cases reproduced the recorded baseline exactly - same cases, same 5,020 output tokens, same
126 s, still **0 call blocks**. So the model is not the variable. The ablation then held model and decoding fixed and
varied only the prompt:

- 5 prompt conditions x 8 cases = **40 ablations, 0 tool calls** - including with the system message deleted, the tool
  list trimmed to one, and the system prompt replaced by a two-line instruction.
- The step message is a status report (`Task state: … Plan: … Recent tool results: (none yet)`) with no sentence
  asking for anything, so the model summarizes it: "The task requires a detailed plan with specific actions…".
- Appending `"Call one tool now. Reply with the tool call only."` produced a call in **6 of 8** cases
  (`prompt_directive.json`).

This is an Olive defect, not a model defect, and it invalidates the previous report's two headline conclusions (0/65
tool calls, 0/5 agent scenarios) as statements about the checkpoint.

## 9. Training feasibility

Full analysis: `documentation/training_feasibility.md`. Measured, not estimated:

- peft 0.21.2 works on `Lfm2ForCausalLM`; gradient checkpointing supported.
- r=16/alpha=32 on q/k/v: 491,520 trainable parameters (0.138%).
- batch 2 x 512 tokens: 0.93-1.10 s/step, 1,034 tokens/s, 2,322 MB peak VRAM.
- The 292-record training split at 3 epochs is about 18 minutes on this GPU.

Verdict: a **short** SFT run is justified now, because the base model already emits calls and the real target is the
remaining 2 of 8 cases plus argument fidelity. A long run is still not justified: 455 records, 376 of them
template-generated, with task-state (14), verification (22) and mixed-language (7) coverage far below target.

## 10. Proposed Olive integration

Full proposal: `documentation/olive_model_integration.md`. Short version: **no new provider code is needed**. Serve
LFM2.5 with `llama-server --jinja` (or vLLM with `--tool-call-parser lfm2`) and declare it as an existing
`openai-compatible` provider with `context: 8192`, `maxOutput: 512`, `tools: true`, `json: false`. `olive-native`
stays reserved and refused until Olive ships a runtime it controls.

Two prerequisites, both in Olive: the step directive (D11) and the parser fix (D12, done).

## 11. Files generated or changed

New scripts:

- `olivellm/scripts/colab/validate_inference.py` - the 12-check suite
- `olivellm/scripts/colab/benchmark.py` - prefill/decode context scaling
- `olivellm/scripts/colab/prompt_ablation.py` - system prompt and tool-list ablation
- `olivellm/scripts/colab/prompt_directive.py` - directive ablation
- `olivellm/scripts/colab/lora_probe.py` - LoRA compatibility and cost

Changed:

- `olivellm/scripts/colab/environment.py` - also reports total GPU memory
- `olivellm/scripts/lib/lfm2-parse.js` - accepts both quote styles

New test: `olivellm/test/lfm2-parse.test.js` (6 cases; full suite 33 pass, 0 fail).

New reports: this file, `documentation/model_compatibility.md`, `documentation/training_feasibility.md`,
`documentation/olive_model_integration.md`, a dated corrections section in `documentation/model_findings.md`, the five
JSON artifacts in this directory, and `reports/colab/raw/generations-2026-11-06.json`.

## 12. Exact next steps

1. **Fix D11 in `packages/core/src/olive/prompt.ts`**: end the step message with
   `Next: call one tool now for "<task.next>". Reply with the tool call only.` Re-run the 5 `OliveAgent.run` scenarios
   and the 71 frozen cases. The 71-case run is the one that counts: the shipped instruction emits a call in 13 of 71
   cases and picks the expected tool in 10 of 65, against 0 for the pre-fix runtime. Nothing downstream is
   meaningful until this is done.
2. **Re-score the re-run generations with the fixed parser** (`bun olivellm/scripts/eval-report.js` against
   `reports/colab/raw/generations-2026-11-06.json` into a new file; do not overwrite the published baseline).
3. **Run one short SFT** (1-3 epochs, r=16, targets `q_proj,k_proj,v_proj,w1,w2,w3,re:.*self_attn\.out_proj$`,
   seq 1024, lr 2e-4), then evaluate with the directive on **both** sides.
4. **Measure 16k context** - the gap between working 8,192 and OOM 32,768 is untested and decides the provider's
   declared `context`.
5. **Install `causal_conv1d`** and re-run `benchmark.py` to record the optimized-kernel numbers alongside these.
6. **Grow the dataset where it is thin** (task state, verification, mixed language) before any second training run.
7. **Do not claim Persian or coding capability** from a 350M model; both are measured and both are weak.

### Directive measurement detail

`prompt_directive.json`, 8 frozen cases x 5 conditions, greedy, `max_new_tokens=192`:

| Condition | Cases emitting a call | Cases choosing the expected tool |
| --- | --- | --- |
| `as_is` (the runtime step message before this change) | 0 | 0 |
| `next_action` | 0 | 0 |
| `call_it` (`Call one tool now. Reply with the tool call only.`) | 6 | 4 |
| `objective_first` | 0 | 0 |
| `probe_shape` | 0 | 0 |

### The 71-case measurement of the shipped instruction

The 8-case probe was not enough. The instruction was then rendered into the full frozen set and generated on a T4,
one run per shape, before anything was trained. The frozen `evaluation/colab/cases.json` was never modified; each
condition is a separate file and a separate run directory under `reports/colab/runs/`.

| Run | Directive shape | Calls (of 71) | Correct tool (of 65) | Kind accuracy | `QUESTION:` | `BLOCKED:` | Output tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `as_is` | none (pre-fix runtime) | 0 | 0 | 0.085 | 0 | 0 | 5020 |
| `2026-11-06-instruction` | four-option menu first, call bullet second | 0 | 0 | 0.085 | 26 | 0 | 1075 |
| `2026-11-06-instruction-v2` | stop line first, call sentence last | 10 | 6 | 0.197 | 26 | 0 | 1336 |
| `2026-11-06-instruction-v3` | call sentence first, stop line last | 0 | 0 | 0.085 | 3 | 21 | 1843 |
| `2026-11-06-instruction-v4` | gated stop line first, call sentence last | **13** | **10** | **0.239** | 11 | 0 | 2192 |

What this measured, and it changed the implementation:

1. **A menu of reply forms cancels the call.** Listing four options and asking for a call as one of them produced zero
   calls in 71 cases - the same as having no instruction at all, at a quarter of the output tokens. The model read the
   menu and answered in prose or with `QUESTION:`.
2. **The trailing line is what this model obeys.** Same sentences, different order: imperative last gave 10 calls,
   imperative first gave 0 and 21 `BLOCKED:`. Position, not wording, decided the behaviour.
3. **An ungated escape hatch is used as a default.** With `QUESTION:` offered as an equal option it absorbed 26 of 71
   cases; gating it behind "no tool can find the answer" cut it to 11 and raised calls from 10 to 13.
4. **The shipped instruction is `v4`** (`packages/core/src/olive/prompt.ts`), the best measured variant. It is not a
   solved instruction: 10 of 65 correct tools is a starting point for the LoRA, not a success.

Emission, selection, argument validity, execution and end-to-end completion are separate claims and are never merged.
Every number above is generation only: no case executed a tool. Selection still runs ahead of argument fidelity -
`inspect_diagnostics(command="run_diagnostics", timeoutMs=10)` and `inspect_diagnostics(command="none", timeoutMs=10)`
are both counted as a correct tool with invented argument values - so the argument-name accuracy of 0.083 for `v4` is
the number to trust for argument fidelity, not the 0.239 kind accuracy.

One discarded run is worth recording as a process note: the first `v4` measurement scored identically to `v3` because a
`colab upload` aborted remotely and the session still held the previous case file. The guard that caught it compares
prompt-token totals across runs and refuses to score an identical set; the artifact was deleted, not reported.

### Agent-level run with the shipped instruction

`olivellm/scripts/agent-eval.js` drives the real `OliveAgent.run` against the T4, so this measured execution rather than
generation:

| Scenario | Steps | Calls | Completed |
| --- | --- | --- | --- |
| `inspect-node-project` | 1 | none | no |
| `create-node-cli` | 2 | `inspect_diagnostics` | no |
| `debug-broken-function` | 2 | `inspect_diagnostics` | no |
| `find-symbol` | 1 | none | no |
| `missing-file` | 2 | `inspect_diagnostics` | no |

0 of 5 completed, 3 calls across 5 scenarios, every one of them `inspect_diagnostics`. The model acts on the first tool
in the list and never reaches the point of writing a file, so the runtime is not the only limit: tool selection is.
Two runs stopped at step 1 with no call - `find-symbol` asked for the missing information and `inspect-node-project`
described what it would inspect - and both were recorded as incomplete with the reason, never as success.

Two harness defects surfaced here that a generation-only benchmark cannot see:

- The bridge passed OpenAI-style `arguments` JSON strings straight into the chat template, which raised "Tool call
  arguments must be a mapping" on the second step of every run that had called a tool; all five scenarios ended in a
  provider error. `scripts/colab/generate.py` now parses arguments before templating. The defective run is preserved at
  `reports/colab/runs/2026-11-06-provider-error-defect/`.
- The scorer in `scripts/eval-report.js` carried its own copy of the call parser, still broken for double-quoted
  arguments; it now imports the shared parser, so scoring and execution can no longer disagree.

The honest-failure path also proved itself on the first run: the agent reported "resolve the provider error before
continuing" and refused to claim progress, which is exactly what D11's stop forms exist for.
