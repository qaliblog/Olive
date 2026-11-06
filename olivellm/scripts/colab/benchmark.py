"""Performance measurements for LiquidAI/LFM2.5-350M on the live Colab session.

Prompt processing and generation are timed as separate phases of a real decode, because one number cannot stand in for
the other: prefill is a single large matmul per layer, decoding is a per-token loop over the cache.

Each row increases the prompt length, measures the prefill of that prompt, then measures the decode of a fixed number
of tokens from it. A length that raises is recorded with its traceback as the stable-context ceiling.

    colab-env.sh exec -s olive-lfm-gpu -f olivellm/scripts/colab/benchmark.py --timeout 1800
"""

import json
import os
import time
import traceback

MODEL = "LiquidAI/LFM2.5-350M"
OUT = os.environ.get("OLIVE_OUT", "/content/olive-benchmark.json")
PROMPT_TOKENS = [512, 2048, 8192, 32768]
DECODE_TOKENS = 32
REPEATS = 3


def main():
    import resource

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    token = os.environ.get("HF_TOKEN")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    started = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    tokenizer_seconds = time.time() - started
    started = time.time()
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model.eval()
    model.to(device)
    model_seconds = time.time() - started

    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    def measure(prompt_tokens, decode_tokens):
        """One prefill pass and one cache-less greedy decode, timed separately."""
        ids = tokenizer(
            "The build copies assets, rewrites imports and emits a bundle. " * 40,
            return_tensors="pt",
        )["input_ids"]
        while ids.shape[1] < prompt_tokens:
            ids = torch.cat([ids, ids[:, : min(ids.shape[1], prompt_tokens - ids.shape[1])]], dim=1)
        ids = ids[:, :prompt_tokens].to(device)

        if device == "cuda":
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
        prefill_started = time.time()
        with torch.no_grad():
            output = model(ids, use_cache=True)
        if device == "cuda":
            torch.cuda.synchronize()
        prefill_seconds = time.time() - prefill_started

        # Decoding goes through the KV cache, one token per forward pass. Re-running the full prompt per token would
        # report prompt-processing cost as generation cost, which is the confusion this measurement exists to avoid.
        cache = output.past_key_values
        decode_started = time.time()
        next_token = output.logits[:, -1:, :].argmax(dim=-1)
        first_token_seconds = time.time() - decode_started
        generated = 1
        with torch.no_grad():
            for _ in range(decode_tokens - 1):
                output = model(next_token, past_key_values=cache, use_cache=True)
                cache = output.past_key_values
                next_token = output.logits[:, -1:, :].argmax(dim=-1)
                generated += 1
        if device == "cuda":
            torch.cuda.synchronize()
        decode_seconds = time.time() - decode_started

        return {
            "prompt_tokens": prompt_tokens,
            "decoded_tokens": generated,
            "prefill_seconds": round(prefill_seconds, 3),
            "prefill_tokens_per_second": round(prompt_tokens / max(prefill_seconds, 1e-9), 1),
            "first_token_seconds": round(first_token_seconds, 4),
            "decode_seconds": round(decode_seconds, 3),
            "decode_tokens_per_second": round(generated / max(decode_seconds, 1e-9), 2),
            "peak_gpu_memory_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1)
            if torch.cuda.is_available()
            else None,
        }

    rows = []
    ceiling = None
    for prompt_tokens in PROMPT_TOKENS:
        try:
            row = measure(prompt_tokens, DECODE_TOKENS)
            if device == "cuda":
                row["peak_gpu_memory_mb"] = round(torch.cuda.max_memory_allocated() / 1024**2, 1)
            rows.append(row)
            ceiling = prompt_tokens
            print(f"ok {prompt_tokens} tokens: prefill {row['prefill_tokens_per_second']} tok/s, "
                  f"decode {row['decode_tokens_per_second']} tok/s", flush=True)
        except Exception as exception:  # noqa: BLE001 - the ceiling is the measured result
            rows.append(
                {
                    "prompt_tokens": prompt_tokens,
                    "status": "fail",
                    "error": f"{type(exception).__name__}: {exception}",
                    "traceback": traceback.format_exc(),
                }
            )
            print(f"fail at {prompt_tokens} tokens: {type(exception).__name__}", flush=True)
            break

    # A short chat decode for first-token latency and generation speed on a realistic prompt.
    messages = [
        {"role": "system", "content": "You are a coding assistant. Answer briefly."},
        {"role": "user", "content": "Write a one-line Node.js function that reverses a string."},
    ]
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    latencies = []
    for _ in range(REPEATS):
        if device == "cuda":
            torch.cuda.synchronize()
        started = time.time()
        with torch.no_grad():
            generated = model.generate(
                **inputs, max_new_tokens=64, do_sample=False, pad_token_id=tokenizer.eos_token_id
            )
        if device == "cuda":
            torch.cuda.synchronize()
        latencies.append(
            {
                "seconds": round(time.time() - started, 3),
                "prompt_tokens": int(inputs["input_ids"].shape[1]),
                "output_tokens": int(generated.shape[1] - inputs["input_ids"].shape[1]),
            }
        )

    report = {
        "status": "measured",
        "model": MODEL,
        "device": device,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "dtype": str(dtype).replace("torch.", ""),
        "torch": torch.__version__,
        "transformers": __import__("transformers").__version__,
        "load": {"tokenizer_seconds": round(tokenizer_seconds, 2), "model_seconds": round(model_seconds, 2)},
        "model_weight_bytes": sum(parameter.numel() * parameter.element_size() for parameter in model.parameters()),
        "peak_system_ram_mb": round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        "context_scaling": rows,
        "max_stable_context_tested": ceiling,
        "chat_generation": {
            "repeats": REPEATS,
            "runs": latencies,
            "prompt_tokens": latencies[0]["prompt_tokens"],
            "mean_seconds": round(sum(run["seconds"] for run in latencies) / len(latencies), 3),
            "generation_tokens_per_second": round(
                sum(run["output_tokens"] for run in latencies)
                / max(sum(run["seconds"] for run in latencies), 1e-9),
                2,
            ),
        },
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(report))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
