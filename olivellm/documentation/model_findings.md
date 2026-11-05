# LFM2.5-350M findings

Every statement is labelled:

- **Observed** - measured by the project on real hardware. The numbers below were supplied by the project
  ledger; this document did not re-run them.
- **Documented** - taken from a primary source on 2026-11-05, with the URL.
- **Hypothesis** - a belief that still needs a measurement.
- **Untested** - no evidence either way.

## Checkpoint

| Property | Value | Evidence |
| --- | --- | --- |
| Model | `LiquidAI/LFM2.5-350M` | project ledger |
| Parameters | 350M | project ledger |
| Layers | 16 | project ledger |
| Tokenizer vocabulary | 64,402 tokens in the installed tokenizer | project ledger |
| Chat template | `<|im_start|>` / `<|im_end|>`, BOS `<|startoftext|>` | **Documented**: `chat_template.jinja` at `huggingface.co/LiquidAI/LFM2.5-350M` |
| Tool call wrapping | `<|tool_call_start|>[...]<|tool_call_end|>` | **Documented**: same template |
| Tool list in prompt | `List of tools: [<json>, <json>]` appended to the system message | **Documented**: same template |
| Tool result message | plain `tool` role, no wrapper tokens, no call id | **Documented**: same template |

The template fetched for this work (2026-11-05) is reproduced by `olivellm/scripts/lib/lfm2.js`. Three details
from it matter for training and are easy to get wrong:

1. String arguments are rendered with **single** quotes and escaped (`\`, `'`, newline, carriage return).
   Numbers, booleans and null are rendered bare; objects and arrays go through JSON.
2. The template **rejects** a `function.arguments` that is a JSON string: "Tool call arguments must be a
   mapping, got a JSON-encoded string: parse arguments with json.loads() before applying the chat
   template". Olive's OpenAI-compatible wire format *is* a string, so any exporter must parse first.
3. Multiple calls in one assistant turn are one list separated by `, ` inside a single pair of
   `tool_call` tokens.

The Liquid docs example shows `get_candidate_status(candidate_id="12345")` with double quotes. The shipped
template for LFM2.5-350M uses single quotes. The template wins; this is recorded because it is exactly the
kind of mismatch that silently teaches the wrong token sequence.

## Observed generation quality

| Task | Result | Evidence |
| --- | --- | --- |
| Node.js generation speed | 52.39 tokens/sec | project ledger |
| React generation speed | 57.59 tokens/sec | project ledger |
| Python smoke test | generated and ran | project ledger |
| Node.js quality | Express + SQLite example had weak database initialisation, persistence and validation | project ledger |
| React quality | component rendered but the button was inactive and behaviour incomplete | project ledger |

Hardware for those runs: a Google Colab Tesla T4 with about 14.56 GB VRAM. At 350M parameters the model fits
comfortably in 4-bit or even 8-bit; the T4 limit is not the constraint for full fine-tuning only if the
optimizer state is kept small (see `training_strategy.md`).

What the two qualitative results imply for the dataset: the base model can produce the *shape* of a
full-stack file but does not complete the wiring (button handler, database init, input validation). The
dataset therefore supervises short, complete, verifiable units - one file per call, a handler that exists, a
schema that is created - instead of long impressive-looking programs.

## Documented workflow for the target runtime

- vLLM serves LFM2.5 with `--enable-auto-tool-choice --tool-call-parser lfm2`.
- llama.cpp serves it with `--jinja` so the model's own template performs the tool formatting.
- The tool list is part of the system prompt, so every extra tool costs tokens on every request. Olive sends
  11 tools with one-line descriptions; that budget must be counted, not assumed.

## Hypotheses (not yet measured)

- H1: A 350M model can reliably emit the native Pythonic call only if the Olive system prompt includes one
  worked example of the token shape. The export includes such examples in the SFT mixture; this is untested.
- H2: Olive's step message (task state plus recent results) is a better conditioning format than replaying
  the full conversation for a model this small. The dataset supervises the step message; the claim needs an
  A/B run.
- H3: Persian quality will be much weaker than English at this size, and code-mixed requests ("این کامپوننت
  را با Tailwind بساز") will degrade further. The Persian slice exists to measure this, not to assume it.
- H4: LoRA (r=16, alpha=32, all linear layers) will reach usable tool selection, but exact argument fidelity
  for long `write_file` content will stay the limiting factor.

## Untested capabilities

No result exists for any of the following, and none is claimed anywhere in this dataset:

- React Native generation.
- Tool calling with the native template (the base checkpoint was not evaluated for it here).
- Persian generation quality.
- Context retention beyond the smoke tests.
- Multi-step autonomous execution inside Olive itself.
- LoRA compatibility and the rank that works.
- GGUF conversion and deployment.

## How the dataset stays honest about this

`scripts/export.js` renders LFM2.5 text with `lib/lfm2.js`, which is a faithful reimplementation of the
template above but has never been executed against the real tokenizer. `lib/lfm2.js` is unit-tested for
quoting, escaping and message framing, and the report states that byte-level parity must be checked once on
Colab with:

```python
tok = AutoTokenizer.from_pretrained("LiquidAI/LFM2.5-350M")
assert tok.apply_chat_template(messages, tools=tools, tokenize=False) == rendered
```

Until that assertion passes in the target environment, the rendering is *documented*, not *verified*.
