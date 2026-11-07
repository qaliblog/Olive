"""Measures the frozen evaluation cases on Colab, with or without a trained adapter.

Inputs come from OLIVE_CASES (default /content/cases.json, uploaded from one of olivellm/evaluation/colab/cases*.json).
Generation is greedy so a rerun reproduces the same text. The report records tokens and latency per case, and the raw
outputs are returned so the scoring happens in the same place the corpus lives.

Set OLIVE_ADAPTER to the directory a training run saved to measure the fine-tuned model on exactly these cases; with
the variable unset the base checkpoint is measured. Everything else (cases, prompt, greedy decoding, token limits) is
identical, which is what makes the two numbers comparable.
"""

import json
import os
import sys
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "LiquidAI/LFM2.5-350M"

# A Colab kernel outlives a single `exec`, so the weights are cached on a module keyed by adapter: a baseline run and
# an adapter run can share one session, and a repeated invocation does not reload the checkpoint.
_cache = sys.modules.get("olive_lfm_cache")
if _cache is None:
    _cache = type(sys)("olive_lfm_cache")
    sys.modules["olive_lfm_cache"] = _cache


def load():
    adapter = os.environ.get("OLIVE_ADAPTER")
    key = f"evaluate:{adapter or 'base'}"
    if getattr(_cache, "evaluate_key", None) == key:
        return _cache.tokenizer, _cache.model, adapter
    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    model.to("cuda" if torch.cuda.is_available() else "cpu")
    _cache.evaluate_key, _cache.tokenizer, _cache.model = key, tokenizer, model
    return tokenizer, model, adapter


def revision():
    try:
        from huggingface_hub import model_info

        return model_info(MODEL, token=os.environ.get("HF_TOKEN")).sha
    except Exception:  # noqa: BLE001 - a missing revision must not lose the measurement
        return None


def main():
    path = os.environ.get("OLIVE_CASES", "/content/cases.json")
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    cases = payload["cases"]

    tokenizer, model, adapter = load()

    results = []
    for case in cases:
        started = time.time()
        prompt = tokenizer.apply_chat_template(
            case["messages"],
            tools=case.get("tools") or None,
            tokenize=False,
            add_generation_prompt=True,
        )
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_new_tokens=192,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        output = tokenizer.decode(generated[0][inputs["input_ids"].shape[1] :], skip_special_tokens=False)
        results.append(
            {
                "id": case["id"],
                "suite": case["suite"],
                "language": case["language"],
                "prompt_tokens": int(inputs["input_ids"].shape[1]),
                "output_tokens": int(generated.shape[1] - inputs["input_ids"].shape[1]),
                "seconds": round(time.time() - started, 3),
                "text": output,
            }
        )

    print("OLIVE_JSON_BEGIN")
    print(
        json.dumps(
            {
                "model": MODEL,
                "revision": revision(),
                "adapter": adapter or None,
                "cases_file": path,
                "cases_sha256": __import__("hashlib").sha256(open(path, "rb").read()).hexdigest(),
                "device": str(model.device),
                "cases": results,
            }
        )
    )
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
