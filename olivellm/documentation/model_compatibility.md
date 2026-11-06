# LFM2.5-350M compatibility report

Model: `LiquidAI/LFM2.5-350M`, revision `9921cd4d82c0e3986887aa4b376f9446729ef8a3` (last modified 2026-11-03).
Measured on 2026-11-06 on a Colab Tesla T4 session named `olive-lfm-gpu`.

Every row says how it is known:

- **Measured** - observed on this run, in `reports/lfm2.5-350m/inference_validation.json`.
- **Documented** - read from the model's own repository or card on 2026-11-06.
- **Untested** - no evidence either way.

## Architecture

It is not a Llama model and must not be configured as one.

| Property | Value | Evidence |
| --- | --- | --- |
| Class | `Lfm2ForCausalLM` | Measured |
| `model_type` | `lfm2` | Documented (`config.json`) |
| Parameters | 354,483,968 | Measured |
| Weight bytes (bf16) | 708,967,936 (676 MiB) | Measured |
| Layers | 16: 10 `conv` + 6 `full_attention` | Measured, matches card |
| Hidden size | 1024 | Measured |
| Intermediate size | 6656 (SwiGLU) | Measured |
| Attention | 16 heads, 8 KV heads (GQA) | Measured |
| Vocabulary | 65,536 configured; 64,402 in the tokenizer | Measured |
| BOS / EOS / PAD | `<|startoftext|>` (1) / `<|im_end|>` (7) / `<|pad|>` (0) | Measured |
| Special token ids | `<|im_start|>` = 6, `<|tool_call_start|>` = 10 | Measured |
| `max_position_embeddings` | 128,000 | Documented |
| Documented context length | 32,768 | Documented (card) |
| Tied embeddings | `tie_embedding: true` | Documented (config) |
| Tokenizer class | `TokenizersBackend` | Measured |
| Chat template | 5,487 characters, ChatML-like, contains the tool block | Measured |
| License | LFM Open License v1.0 | Documented |

The 10 convolution blocks are double-gated short convolutions with `conv_L_cache: 3`. That is why loading prints a
`causal_conv1d` fallback warning and why every speed number below is a reference-kernel number (see failures).

**Context length is 32,768.** The config's 128,000 positional capacity is not the supported context; the card states
32,768 and that is what a provider document should declare. `reports/colab/baseline_metrics.json` already divides by
32,768, so its 4.3% context usage is correct.

## Loading and runtime

| Question | Answer | Evidence |
| --- | --- | --- |
| `AutoModelForCausalLM` works | Yes | Measured |
| `from_pretrained(..., dtype=...)` | Yes; `bfloat16` on GPU | Measured |
| Transformers version used | 5.22.0 (Python 3.13.16, torch 2.11.0+cu130) | Measured |
| `AutoTokenizer` works | Yes, 1.57 s cold, 0.55 s warm | Measured |
| Model load | 14.89 s cold (download + init), 0.39 s warm from cache | Measured |
| `apply_chat_template(messages, tools, tokenize=False)` | Yes | Measured |
| Checkpoint files | 14 files, 713,753,256 bytes total; weights + tokenizer only | Measured |
| GPU | T4 16 GB runs it at 676 MiB of weights | Measured |
| CPU | Runs (CPU probe session); not benchmarked | Untested for speed |
| Quantization | GGUF, ONNX, MLX, OpenVINO checkpoints published by Liquid | Documented |

## Generation behaviour

The card recommends `temperature: 0.1`, `top_k: 50`, `repetition_penalty: 1.05`. Greedy decoding is deterministic on
this model: three identical runs produced byte-identical text.

Two guidance statements matter more than any benchmark table:

- The card says the model is **"not recommended for knowledge-intensive tasks and programming."**
- The card recommends it for "data extraction, structured outputs, and tool use."

That is the opposite of what Olive needs from a model, and it is the reason the integration proposal keeps
deterministic tools and templates in charge of code and gives the model the decision, not the code.

## Tool calling

The native format is a Python list between `<|tool_call_start|>` and `<|tool_call_end|>`:

```
<|tool_call_start|>[list_directory(path="src")]<|tool_call_end|>
```

| Question | Answer | Evidence |
| --- | --- | --- |
| Emits the native block | **Yes**, 12 output tokens, greedy and sampled | Measured |
| Quote style actually emitted | **Double quotes**, `path="src"` | Measured |
| Quote style the chat template renders | **Single quotes**, `path='src'` | Measured |
| Argument schema | Not enforced by the model; the caller validates | Measured |
| JSON-format calls | Card says the default Pythonic form can be overridden by asking for JSON in the system prompt | Documented |
| vLLM | `--enable-auto-tool-choice --tool-call-parser lfm2` | Documented |
| llama.cpp | `--jinja` so the model's own template does the formatting | Documented |

The quote mismatch is not cosmetic. `olivellm/scripts/lib/lfm2-parse.js` accepted only single-quoted values, so a
genuine call written the way the model writes it was scored `invalid` with zero calls parsed. The parser now accepts
either quote style; see `reports/lfm2.5-350m/REPORT.md`.

## What the model can and cannot do, measured

| Capability | Result |
| --- | --- |
| Plain completion | Works, coherent Python continuation |
| Chat completion | Works, short factual answer |
| Multi-turn with prior assistant turn | Works, answers the second question |
| English coding answer | Produces a correct `readJsonFile` with `fs`, `JSON.parse` and a throw |
| Structured JSON output | Valid JSON, but wrapped in a ```json fence despite instructions |
| Persian | Produces Persian prose but the content is incoherent and repetitive |
| 3.2k-token needle retrieval | Correct answer from the middle of the prompt |
| Tool call from a direct question | Correct tool and argument |
| Tool call from Olive's task-state step message | **Never** (0 of 40 ablations) |
| Factual knowledge | Weak: `npm ci` answer is wrong |

The Persian result is the important one for planning: the surface script works, the semantics do not. Persian should
not be a claimed capability of an Olive model at this size without a dedicated, measured evaluation.

## Licensing constraint

LFM Open License v1.0 grants commercial use below an annual revenue threshold of **USD 10,000,000**; above it a
separate license is required. Attribution and the license text must travel with any redistributed checkpoint, which
matters for a distributed Olive model but not for local use.
