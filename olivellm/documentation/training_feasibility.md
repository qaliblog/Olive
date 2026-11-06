# LFM2.5-350M LoRA feasibility

Measured on 2026-11-06 on a Colab Tesla T4 (`olive-lfm-gpu`), peft 0.21.2, transformers 5.22.0, torch 2.11.0+cu130.
Raw numbers: `reports/lfm2.5-350m/lora_probe.json`.

## Verdict, and what changed

The previous strategy said training was blocked because "the base model does not yet emit tool calls at all". That
premise is **false**. The base checkpoint emits a correct native call in 12 output tokens when it is asked to
(`reports/lfm2.5-350m/inference_validation.json`), and 6 of 8 frozen cases produce a call once the step message ends
with `"Call one tool now. Reply with the tool call only."` (`prompt_directive.json`).

So the target of a first run is narrower than "teach tool calling from zero": it is to close the remaining 2 of 8 and
to improve argument fidelity. **A short SFT run is justified. A long one is not.**

## LoRA compatibility, measured

| Question | Result |
| --- | --- |
| peft works on `Lfm2ForCausalLM` | Yes, peft 0.21.2 |
| Blocker found | peft requires `torchao>=0.16.0`; Colab ships 0.10.0 → `ImportError`. Fixed with `colab install "torchao>=0.16.0"` |
| Gradient checkpointing | Supported (`model.gradient_checkpointing_enable()` did not raise; HF sets `use_cache=False` as expected) |
| Trainable parameters, r=16/alpha=32 on q/k/v | 491,520 (0.138% of 354,483,968) |
| Peak VRAM, batch 2 × 512 tokens | 2,322 MB |
| Step time | 0.93-1.10 s |
| Throughput | 1,034 tokens/s |
| 3-step loss trace | 4.2659 → 2.5302 → 4.2723 (batch of 2 records; noise, not convergence) |

### The target-module trap

The linear inventory of the real checkpoint is:

| Module | Count | Belongs to |
| --- | --- | --- |
| `q_proj`, `k_proj`, `v_proj` | 6 each | the 6 GQA blocks |
| `out_proj` | 16 | **both** the 6 attention blocks and the 10 conv blocks |
| `in_proj` | 10 | conv blocks |
| `w1`, `w2`, `w3` | 16 each | the MLP of all 16 blocks |
| `lm_head` | 1 | output |

There is **no `o_proj`**. The attention output projection is named `out_proj`, and that name is shared with the
convolution blocks. Two consequences:

1. The plan in this repository ("target `q_proj`, `k_proj`, `v_proj`, `o_proj`") would have trained **only q/k/v** and
   silently skipped the attention output projection - exactly what the probe did, since it filtered to suffixes that
   exist.
2. To adapt attention plus the MLP, target `q_proj`, `k_proj`, `v_proj`, `w1`, `w2`, `w3` and select the attention
   `out_proj` by pattern (`re:.*self_attn\.out_proj$`), not by bare suffix - a bare `out_proj` also hits the 10 conv
   blocks, which may be desirable but must be a deliberate choice, not a side effect.

## Precision on this hardware

The T4 has no bf16 tensor cores. The probe ran bf16 and worked, but fp16 with a gradient scaler is the faster path on
this GPU; bf16 is the better choice on Ampere or newer (A100, L4). Nothing in the measurements above depends on which
is used beyond speed.

## Cost of a realistic first run

The exported training split is 292 records / 369,277 rendered tokens.

| Run | Tokens (3 epochs) | Time at 1,034 tokens/s |
| --- | --- | --- |
| seq 512, batch 2, 1 epoch | 369,277 | ~6 min |
| 3 epochs | 1.1 M | ~18 min |
| seq 1024, batch 2, 3 epochs | 1.1 M (same tokens, fewer steps) | ~18 min |

That fits inside one T4 session with room for evaluation. It is not a multi-hour job, which is why the earlier
"do not launch training" caution no longer applies to a first run - only to a long one.

## Configuration the measurements support

```python
LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
    task_type="CAUSAL_LM",
    target_modules=["q_proj", "k_proj", "v_proj", "w1", "w2", "w3", r"re:.*self_attn\.out_proj$"],
)
```

- Sequence length 1024 covers p95 prompt (607 estimated tokens) plus a 192-token answer. The longest record is 1,859
  estimated tokens: use 2048 for the second configuration instead of truncating.
- Loss on `target` only. `text.endsWith(target)` holds for every exported record, so the mask is a slice, not a
  heuristic.
- Learning rate: 2e-4 first, then 5e-4 and 1e-3. With 292 records, overfitting is visible in validation loss within
  one or two epochs.
- Save every 50 steps and keep the adapter only. The base checkpoint is 676 MiB; adapters are ~2 MB.

## Evaluation that must accompany the run

1. Same 71 frozen cases, same greedy decoding, **with the directive fix applied to both baseline and fine-tuned
   model**. Comparing a fine-tuned model that gets a directive against a baseline that never did would be a false win.
2. Report per suite (tool calling, coding, multilingual, baseline) and per language.
3. Agent-level: rerun the 5 `OliveAgent.run` scenarios. The bar is one executed tool call per scenario and no
   completion claimed without verification.
4. Argument fidelity separately from tool selection: a run that selects the right tool with wrong arguments is not a
   win, and long `write_file` content is the expected failure mode.

## Risks that remain

- **The corpus is small and template-heavy**: 455 records, 376 of them template-generated. A LoRA can learn the
  template's voice rather than the behaviour.
- **Coverage shortfalls are real**: task state 14, verification 22, mixed language 7 records.
- **6 of 8 is the base ceiling under a directive**; the other 3 cases are the actual learning target, and 8 cases is a
  very small sample for that claim.
- **Persian is not a capability yet**: the model produces Persian characters with incoherent content. Persian should be
  evaluated, not claimed.
- **16k context is untested**: 8,192 works and 32,768 raises OOM on a T4, so the stable ceiling lies somewhere between.
