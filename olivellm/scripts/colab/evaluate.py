"""Runs the frozen evaluation cases through the unmodified base model on Colab.

Inputs come from OLIVE_CASES (default /content/cases.json, uploaded from olivellm/evaluation/colab/cases.json).
Generation is greedy so a rerun reproduces the same text. The report records tokens and latency per case, and the raw
outputs are returned so the scoring happens in the same place the corpus lives.
"""

import json
import os
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "LiquidAI/LFM2.5-350M"


def main():
    path = os.environ.get("OLIVE_CASES", "/content/cases.json")
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    cases = payload["cases"]

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model.eval()
    model.to("cuda" if torch.cuda.is_available() else "cpu")

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
                "device": str(model.device),
                "cases": results,
            }
        )
    )
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
