# OliveLLM training strategy

Status: one controlled LoRA run on the corrected prompt is justified now, and a long run is not. The earlier claim that
the base model cannot emit tool calls was wrong: it emits native calls, and the zero-call baseline was caused by a
runtime prompt with no instruction (defect D11, fixed in `packages/core/src/olive/prompt.ts`). See
`documentation/training_feasibility.md` for the measured probe and `reports/lfm2.5-350m/REPORT.md` for the evidence.
Everything below is the plan the measured results support.

## Base model

`LiquidAI/LFM2.5-350M`, unmodified, is the baseline. It was evaluated on a Colab T4 with greedy decoding over 71
held-out cases (`reports/colab/baseline_metrics.json`). The recorded result was 0 of 65 tool-call cases producing a
parseable call, and that number reproduces exactly - but it is a property of the prompt, not of the checkpoint. Given
an instruction to act, the same model called a tool in 6 of 8 frozen cases and chose the expected tool in 4 of them
(`reports/lfm2.5-350m/prompt_directive.json`). The baseline must therefore be re-measured with the corrected runtime
prompt before any fine-tuned comparison; the old number is kept only as the pre-fix record.

A 350M model has roughly 350M parameters; a tool-calling LoRA on this base is a behaviour-injection job, not a
knowledge job. The corpus is small (455 records, ~182k prompt+answer tokens), so the realistic goal for a first run is
"emits a syntactically valid call block for the right tool", not "solves coding tasks".

## Tokenizer and chat template

The tokenizer is the model's own. The chat template is reproduced byte for byte in `scripts/lib/lfm2.js` and verified
against `tokenizer.apply_chat_template(messages, tools, tokenize=False)` for 17 fixtures covering English, Persian,
mixed language, system/user/assistant/tool messages, single and multiple tool calls, escaped quotes, newlines, tabs,
Unicode, empty arguments, nested JSON arguments, numeric/boolean arguments, long arguments and the generation prompt
(`reports/colab/tokenizer_parity.json`, 17/17 byte-identical).

Consequences for training:

- Train on the rendered string `text`, and mask the loss to `target` (`assistantTarget`), which is the assistant turn
  without the trailing `<|im_end|>\n`. Masking the prompt teaches the model to reproduce tool output instead of calling
  tools.
- The tool list lives in the system message and is rendered by the template. Keep the exported `tools` array identical
  to `OliveTools.definitionsFor()`; `olivellm/test/tool-parity.test.js` enforces that the dataset copy matches.
- Argument quoting (`'value'`, `True`, `None`, JSON for nested values) is part of the target text. Do not post-process
  arguments before training; the model must learn the exact surface form.

## LoRA strategy

- Target the attention projections and, in a second run, the MLP projections. There is **no `o_proj`** on this
  architecture: the attention output is `out_proj`, and that name is shared with the 10 convolution blocks, so it must
  be selected by pattern (`re:.*self_attn\.out_proj$`), never by bare suffix. Measured linear inventory: `q_proj`,
  `k_proj`, `v_proj` 6 each, `out_proj` 16 (6 attention + 10 conv), `in_proj` 10, `w1`/`w2`/`w3` 16 each, `lm_head` 1.
  At 350M parameters a rank of 16 with alpha 32 is a reasonable first point; sweep rank 8/16/32.
- Freeze embeddings and the LM head in the first run. The vocabulary is fixed and the task is formatting plus
  behaviour, not new tokens.
- Sequence length 1024 covers the p95 prompt (607 estimated tokens) plus a 192-token answer. The longest record is
  1859 estimated tokens; pad to 2048 in a second configuration rather than truncating.
- The probe ran bf16 and worked, but the T4 has no bf16 tensor cores: fp16 with a gradient scaler is faster on this
  GPU, while bf16 is the better choice on Ampere or newer. Keep gradient accumulation at 8-16 with a small batch,
  since the corpus is ~465k tokens total.
- Measured cost at batch 2 x 512 tokens: 0.93-1.10 s/step and 1,034 tokens/s, so the 292-record training split is about
  6 minutes per epoch on a T4.

## Dataset formatting

- `datasets/processed/sft-{train,validation,test}.jsonl` are ready-to-tokenize records: `messages`, `tools`, `text`,
  `target`, `tokens`.
- Loss is computed on `target` only. `text.length >= target.length` and `text.endsWith(target)` hold for every record by
  construction in `scripts/export.js`.
- Do not shuffle across splits or mix held-out records back in. The held-out ids are frozen.

## Train/validation/test separation

Group-based, not id-based: 171 groups over `(project, generator family, trajectory, language)`. Counts: train 292,
validation 48, test 58, held-out 57. Zero groups and zero records overlap between splits (`split-manifest.json`,
`leakage`). Validation is for early stopping; test is for the final number; held-out drives the Colab evaluation and
never trains.

## Hyperparameter experiments to consider

1. Learning rate 2e-4 vs 5e-4 vs 1e-3 with rank 16 — the corpus is small, so overfitting shows up in validation loss
   within one or two epochs.
2. Target modules: attention only vs attention + MLP.
3. Loss masking: target-only vs full sequence, to quantify how much the model copies tool output instead of acting.
4. Class balance: the current tool distribution is dominated by `read_file` (134) and `project_structure` (73). An
   experiment with tool-balanced sampling (cap the top tools, repeat the rare ones) is only meaningful after the rare
   tools have more real examples than the 8-38 they have now.
5. Prompt format: with and without the full tool list in the system message, to measure how much the list helps a 350M
   model select tools.
6. Decoding at evaluation: greedy (baseline condition) and constrained decoding against the tool schema, reported
   separately. Constrained decoding must never be reported as if it were the model's own accuracy.

## Evaluation methodology

- Same 71 cases, same prompts, same greedy decoding for baseline and fine-tuned model. `evaluation/colab/cases.jsonl` is
  frozen; regenerate only by re-running `node scripts/eval-cases.js` after a split change, and say so.
- Report per-suite metrics (tool calling, coding, multilingual, baseline) and per-language metrics, never one score.
- Score from the raw generation: a call counts only if the LFM2.5 call block parses. Never repair a generation by hand.
- Keep failures. `reports/colab/FAILURES.md` lists every failing case with the parsed call.
- Agent-level evaluation runs the real `OliveAgent.run` (real prompt, real executor, real task state, real completion
  rule) with only the model transport bridged to Colab, so a fine-tuned model can be compared under identical
  conditions.

## Risks and limitations

- **Coverage shortfalls.** Planning (53/200), task state (14/200), coding (78/300) and mixed language (7/50) are far
  from target. Training now would teach tool formatting and little else.
- **Template-heavy provenance.** 376 of 455 records are template-generated. The 79 executed records are real, but they
  are six scenarios plus per-tool probes, not six months of agent experience.
- **Single model, single run.** The baseline is one greedy decode of one 350M model. Nothing here establishes variance.
- **Completion honesty is a rule, not a learned behaviour yet.** The runtime refuses to claim completion without a
  passing test; the dataset encodes the same rule, but the model has not been shown to learn it.
- **Persian surface forms.** 89 Persian records with no native-speaker review; templates can repeat phrasing.
- **Coding evaluation depth.** The coding suite checks file production and syntax. It does not run generated
  applications end to end.
