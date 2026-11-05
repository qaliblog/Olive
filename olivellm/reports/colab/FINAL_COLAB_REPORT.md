# Colab report

All runs used the installed `colab` CLI with `olivellm/scripts/colab/colab-env.sh`, which sources `HF_TOKEN` from the
repository `.env` and passes it with the CLI's supported `--env` option. The token is never printed, never written to a
notebook, and never stored in a report.

## Environment

`reports/colab/environment.json`:

| Field | Value |
| --- | --- |
| Session | olivellm-eval (GPU) / olivellm-probe (parity, CPU) |
| Python | 3.13.16 |
| torch | 2.11.0+cu130 |
| device | Tesla T4 (cuda:0) for evaluation, CPU for tokenizer work |
| transformers | 5.22.0 |

## Authentication

`reports/colab/authentication.json` records status only:

- token present in the kernel environment: yes
- Hugging Face authentication: authenticated
- account: `Qalibgh`
- token logged: no

Verification method: `huggingface_hub.HfApi.whoami()` inside the Colab kernel, with only the account name copied out of
the response (the response also contains the credential in some versions, so it is never serialised).

## Tokenizer parity

`reports/colab/tokenizer_parity.json` — **17 of 17 fixtures byte-identical** to
`tokenizer.apply_chat_template(messages, tools, tokenize=False)` for `LiquidAI/LFM2.5-350M`.

Coverage: English, Persian, mixed Persian/English, system-only, user-only, assistant-only, single tool call, multiple
tool calls, tool result, escaped quotes and backslashes, newlines and tabs, Unicode/emoji, empty arguments, nested JSON
arguments, numeric and boolean arguments, long arguments, and the generation prompt.

Three real defects were found and fixed in `scripts/lib/lfm2.js` before parity passed:

1. Object and array argument values rendered as `[object Object]` instead of `tojson`.
2. A JSON-string argument threw for `""`/`{}`/`null`, which the template tolerates as "no arguments".
3. Non-string content was always `tojson`; the template concatenates list-of-parts content.

`reports/colab/tokenizer_mismatches.json` is empty. Parity is re-checked by regenerating fixtures and rerunning the
comparison; a single differing character fails the run.

## Baseline evaluation

`reports/colab/baseline_metrics.json`, `tool_call_evaluation.json`, `coding_evaluation.json`,
`multilingual_evaluation.json`, `baseline_evaluation.json`, `raw/generations.jsonl`.

Conditions: unmodified base model, greedy decoding, `max_new_tokens=192`, 71 held-out cases (tool_calling 24, coding
11, multilingual 12, baseline 24; languages: 51 English, 14 mixed, 6 Persian), identical prompts to any future
fine-tuned run.

| Metric | Value |
| --- | --- |
| Cases | 71 |
| Tool-call cases | 65 |
| Valid tool-call rate | 0.00 |
| Tool selection accuracy | 0.00 |
| Argument name accuracy | 0.00 |
| Required-argument rate | 0.00 |
| Argument type accuracy | 0.00 |
| Response kind accuracy | 0.085 |
| Prompt tokens | 99,436 |
| Generated tokens | 5,020 |
| Throughput | 40.2 tokens/s |
| Average latency | 1.76 s/case |
| Context usage | 4.3% of 32k |

The decisive observation, checked directly against the raw generations: **0 of 71 generations contain the
`<|tool_call_start|>` marker**. The model narrates the task ("The task requires a detailed plan with specific
actions…") instead of acting. Every downstream metric that depends on a tool call is therefore zero, by fact rather than
by parser failure.

Coding and multilingual suites inherit the same result: no coding case produced a file (11 of 11 missing, so no syntax or
execution check could run), and multilingual tool accuracy is zero for both Persian and mixed-language cases. One
Persian case produced Persian prose, so the language surface works; the tool format does not exist yet.

## Agent workflow evaluation

`reports/colab/agent_workflow_evaluation.json`, `raw/agent-generations.json`.

Five scenarios were run through the real `OliveAgent.run`: real prompt construction, real `OliveTools` execution
against a seeded workspace, real task-state folding, real completion rule. Only the model transport is bridged — each
model request is uploaded to the live Colab session, rendered with the real chat template, completed there, and
returned as an OpenAI-shaped stream.

| Scenario | Steps | Tool calls chosen | Completed | Next action recorded |
| --- | --- | --- | --- | --- |
| inspect-node-project | 1 | 0 | false | inspect the project before reporting a result |
| create-node-cli | 1 | 0 | false | inspect the project before reporting a result |
| debug-broken-function | 1 | 0 | false | inspect the project before reporting a result |
| find-symbol | 1 | 0 | false | inspect the project before reporting a result |
| missing-file | 1 | 0 | false | inspect the project before reporting a result |

0 of 5 scenarios completed; 0 tool calls were executed because the model emitted none (5 model requests, average prompt
1,283 tokens, average output 95 tokens). The agent did not claim success:
`completion` refused to accept "no operation happened" as completion, and each task state was written with an explicit
next action. That is the behaviour the completion rule exists for — a direct generation in the same condition produces
the same unusable answer but nothing stops it from being read as success.

## Failures

`reports/colab/FAILURES.md` lists the failing cases with the expected tool and what was parsed. All 65 tool-call cases
fail on the same cause: no call block in the generation.

## Not run

- LoRA training and the fine-tuned comparison. Blocked deliberately: the base model emits no tool calls, and coverage
  targets for planning, task state, coding and mixed language are not met.
- Constrained decoding, multi-sample variance, and longer generations. The baseline is a single greedy decode.
- Coding execution beyond syntax: generated applications are not run end to end.
