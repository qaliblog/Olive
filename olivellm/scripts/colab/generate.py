"""Generates one completion for an OpenAI-shaped chat request, on the session the caller already started.

Used by olivellm/scripts/agent-eval.js: the request is uploaded to /content/request.json, this file renders it with the
real LFM2.5 chat template (including the tool list) and returns the raw text plus token accounting.
"""

import json
import os
import time

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL = "LiquidAI/LFM2.5-350M"

_state = {}


def load():
    if "model" in _state:
        return _state["tokenizer"], _state["model"]
    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model.eval()
    model.to("cuda" if torch.cuda.is_available() else "cpu")
    _state["tokenizer"], _state["model"] = tokenizer, model
    return tokenizer, model


def normalise(messages):
    """The OpenAI wire format carries tool-call arguments as a JSON string; the chat template needs a mapping.

    Without this the template raises "Tool call arguments must be a mapping", which surfaces to the agent as a provider
    error on the second step of every run that called a tool.
    """
    normalised = []
    for message in messages:
        calls = message.get("tool_calls") or []
        if not calls:
            normalised.append(message)
            continue
        normalised.append(
            {
                **message,
                "tool_calls": [
                    {
                        **call,
                        "function": {
                            **call["function"],
                            "arguments": json.loads(call["function"]["arguments"])
                            if isinstance(call["function"].get("arguments"), str)
                            else call["function"].get("arguments", {}),
                        },
                    }
                    for call in calls
                ],
            }
        )
    return normalised


def main():
    with open("/content/request.json", encoding="utf-8") as handle:
        request = json.load(handle)
    tokenizer, model = load()
    started = time.time()
    prompt = tokenizer.apply_chat_template(
        normalise(request["messages"]),
        tools=request.get("tools") or None,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    with torch.no_grad():
        generated = model.generate(
            **inputs,
            max_new_tokens=max(32, int(request.get("max_tokens", 192))),
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )
    text = tokenizer.decode(generated[0][inputs["input_ids"].shape[1] :], skip_special_tokens=False)
    print("OLIVE_JSON_BEGIN")
    print(
        json.dumps(
            {
                "model": MODEL,
                "text": text,
                "prompt_tokens": int(inputs["input_ids"].shape[1]),
                "output_tokens": int(generated.shape[1] - inputs["input_ids"].shape[1]),
                "seconds": round(time.time() - started, 3),
            }
        )
    )
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
