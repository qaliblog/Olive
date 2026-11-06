"""Twelve inference checks against LiquidAI/LFM2.5-350M, run on the live Colab session.

Each check is independent and records its own result. A failure keeps the complete traceback and a short root-cause
label, so a broken check can never be reported as skipped: the report always contains twelve entries, each with an
explicit pass/fail and the evidence behind it.

The script prints one JSON document between OLIVE_JSON_BEGIN/OLIVE_JSON_END and writes the same document to
OLIVE_OUT (default /content/olive-inference.json) for `colab download`.

    colab-env.sh exec -s olive-lfm-gpu -f olivellm/scripts/colab/validate_inference.py --timeout 1800
"""

import json
import os
import platform
import re
import time
import traceback

MODEL = "LiquidAI/LFM2.5-350M"
OUT = os.environ.get("OLIVE_OUT", "/content/olive-inference.json")

_state = {}


def load():
    """Downloads and initialises the checkpoint once; every check reuses it."""
    if "model" in _state:
        return _state["tokenizer"], _state["model"], _state["load"]
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    token = os.environ.get("HF_TOKEN")
    started = time.time()
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    tokenizer_seconds = time.time() - started
    started = time.time()
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model.eval()
    model.to("cuda" if torch.cuda.is_available() else "cpu")
    model_seconds = time.time() - started
    _state["tokenizer"] = tokenizer
    _state["model"] = model
    _state["load"] = {
        "tokenizer_seconds": round(tokenizer_seconds, 2),
        "model_seconds": round(model_seconds, 2),
        "dtype": str(dtype).replace("torch.", ""),
        "device": str(model.device),
    }
    return tokenizer, model, _state["load"]


def generate(prompt=None, messages=None, tools=None, max_new_tokens=192, sampling=None):
    """One decode. `sampling` None means greedy; a dict is passed to generate() as the sampling parameters."""
    import torch

    tokenizer, model, _ = load()
    if prompt is None:
        prompt = tokenizer.apply_chat_template(
            messages, tools=tools or None, tokenize=False, add_generation_prompt=True
        )
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    params = sampling or {"do_sample": False}
    started = time.time()
    with torch.no_grad():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            pad_token_id=tokenizer.eos_token_id,
            **params,
        )
    new_tokens = int(output.shape[1] - inputs["input_ids"].shape[1])
    return {
        "prompt": prompt,
        "text": tokenizer.decode(output[0][inputs["input_ids"].shape[1] :], skip_special_tokens=False),
        "prompt_tokens": int(inputs["input_ids"].shape[1]),
        "output_tokens": new_tokens,
        "seconds": round(time.time() - started, 3),
    }


def tool_call_test():
    """Does the checkpoint emit its own native call block when the template is given a tool list?"""
    tools = [
        {
            "name": "list_directory",
            "description": "List the entries of one directory in the workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
        {
            "name": "read_file",
            "description": "Read one file from the workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    ]
    messages = [
        {
            "role": "system",
            "content": "You are a coding agent. Use a tool to answer. Do not describe what you would do.",
        },
        {"role": "user", "content": "What files are in the src directory? Use the list_directory tool."},
    ]
    greedy = generate(messages=messages, tools=tools, max_new_tokens=128)
    # The model card recommends temperature 0.1 / top_k 50 / repetition_penalty 1.05. The frozen baseline in this
    # repository used greedy decoding, so the two are measured side by side instead of assuming one stands for both.
    sampled = generate(
        messages=messages,
        tools=tools,
        max_new_tokens=128,
        sampling={"do_sample": True, "temperature": 0.1, "top_k": 50, "repetition_penalty": 1.05},
    )
    json_mode = generate(
        messages=[
            messages[0],
            {
                "role": "user",
                "content": messages[1]["content"]
                + ' Answer with a JSON function call instead of the default format: {"name": ..., "arguments": {...}}',
            },
        ],
        tools=tools,
        max_new_tokens=128,
        sampling={"do_sample": True, "temperature": 0.1, "top_k": 50, "repetition_penalty": 1.05},
    )

    def score(result):
        blocks = re.findall(r"<\|tool_call_start\|>(.*?)<\|tool_call_end\|>", result["text"], re.S)
        return {
            "text": result["text"],
            "call_blocks": len(blocks),
            "raw_blocks": blocks,
            "names_a_tool": any(tool["name"] in result["text"] for tool in tools),
            "output_tokens": result["output_tokens"],
            "seconds": result["seconds"],
        }

    return {
        "tools_sent": [tool["name"] for tool in tools],
        "prompt_contains_tool_list": "List of tools:" in greedy["prompt"],
        "greedy": score(greedy),
        "recommended_sampling": score(sampled),
        "json_instruction": score(json_mode),
    }


def structured_test():
    """JSON-shaped answer, checked by parsing what the model actually produced."""
    messages = [
        {"role": "system", "content": "You answer only with a single JSON object. No prose, no code fence."},
        {
            "role": "user",
            "content": 'Return {"file": "src/index.js", "action": "read_file", "reason": "<short>"} for a task that must read src/index.js before editing.',
        },
    ]
    result = generate(messages=messages, max_new_tokens=128)
    parsed = None
    error = None
    try:
        text = result["text"].strip()
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
        parsed = json.loads(text[text.index("{") : text.rindex("}") + 1])
    except Exception as exception:  # noqa: BLE001 - the failure is the result
        error = type(exception).__name__
    return {**result, "valid_json": parsed is not None, "parsed": parsed, "parse_error": error}


def long_context_test():
    """Retrieval from the middle of a long prompt: the answer is a token that only appears in the haystack."""
    needle = "OLIVE-MARKER-7412"
    filler = (
        "The build pipeline copies assets, rewrites imports and emits a bundle. "
        "Each stage logs one line and may fail without stopping the whole run. "
    )
    paragraphs = []
    while len(" ".join(paragraphs).split()) < 2400:
        paragraphs.append(filler)
    middle = len(paragraphs) // 2
    paragraphs[middle] = f"Deployment note: the staging host for this project is {needle}. " + paragraphs[middle]
    messages = [
        {"role": "system", "content": "Answer questions about the document with one short phrase."},
        {
            "role": "user",
            "content": "\n\n".join(paragraphs) + "\n\nQuestion: what is the staging host?",
        },
    ]
    result = generate(messages=messages, max_new_tokens=48)
    return {**result, "needle": needle, "found": needle in result["text"]}


def repeated_test():
    """Greedy decoding must be deterministic; three runs of one prompt are compared byte for byte."""
    messages = [
        {"role": "system", "content": "You are a concise coding assistant."},
        {"role": "user", "content": "Write the first line of a Node.js HTTP server."},
    ]
    runs = [generate(messages=messages, max_new_tokens=64) for _ in range(3)]
    texts = [run["text"] for run in runs]
    return {
        "text": texts[0],
        "runs": 3,
        "identical": len(set(texts)) == 1,
        "output_tokens": [run["output_tokens"] for run in runs],
        "seconds": [run["seconds"] for run in runs],
    }


def download_test():
    """The checkpoint itself: revision, file count, and the sizes actually fetched."""
    from huggingface_hub import HfApi

    token = os.environ.get("HF_TOKEN")
    info = HfApi(token=token).model_info(MODEL, files_metadata=True)
    files = [
        {"name": sibling.rfilename, "bytes": sibling.size}
        for sibling in info.siblings
        if sibling.size is not None
    ]
    _, _, load_info = load()
    return {
        "sha": info.sha,
        "last_modified": str(info.lastModified),
        "file_count": len(files),
        "total_bytes": sum(file["bytes"] for file in files),
        "files": [file for file in files if file["bytes"] > 1_000_000],
        "load": load_info,
    }


def tokenizer_test():
    tokenizer, _, _ = load()
    template = tokenizer.chat_template or ""
    return {
        "class": type(tokenizer).__name__,
        "vocab_size": tokenizer.vocab_size,
        "len": len(tokenizer),
        "bos_token": str(tokenizer.bos_token),
        "eos_token": str(tokenizer.eos_token),
        "pad_token": str(tokenizer.pad_token),
        "padding_side": tokenizer.padding_side,
        "has_chat_template": bool(template),
        "chat_template_chars": len(template),
        "chat_template_has_tool_block": "<|tool_call_start|>" in template,
        "sample_tokens": {
            "bos": tokenizer.encode(tokenizer.bos_token or "", add_special_tokens=False),
            "im_start": tokenizer.encode("<|im_start|>", add_special_tokens=False),
            "tool_call_start": tokenizer.encode("<|tool_call_start|>", add_special_tokens=False),
        },
    }


def model_test():
    _, model, load_info = load()
    import torch

    config = model.config
    layer_types = list(getattr(config, "layer_types", []) or [])
    return {
        "class": type(model).__name__,
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "trainable_parameters": sum(
            parameter.numel() for parameter in model.parameters() if parameter.requires_grad
        ),
        "dtype": str(next(model.parameters()).dtype).replace("torch.", ""),
        "device": str(model.device),
        "layers": config.num_hidden_layers,
        "layer_types": {"conv": layer_types.count("conv"), "full_attention": layer_types.count("full_attention")},
        "hidden_size": config.hidden_size,
        "intermediate_size": config.intermediate_size,
        "attention_heads": config.num_attention_heads,
        "kv_heads": getattr(config, "num_key_value_heads", None),
        "vocab_size": config.vocab_size,
        "max_position_embeddings": config.max_position_embeddings,
        "tied_embeddings": bool(getattr(config, "tie_embedding", False)),
        "weight_bytes": sum(parameter.numel() * parameter.element_size() for parameter in model.parameters()),
        "cuda_peak_allocated_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1)
        if torch.cuda.is_available()
        else 0,
        "load": load_info,
    }


def plain_completion_test():
    result = generate(prompt="def parse_flags(argv):\n    \"\"\"Parse CLI flags.\"\"\"\n", max_new_tokens=96)
    ok = result["output_tokens"] > 0 and len(result["text"].strip()) > 0
    return {**result, "non_empty": ok}


def chat_test():
    messages = [
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "In one sentence, what does npm ci do compared with npm install?"},
    ]
    result = generate(messages=messages, max_new_tokens=96)
    return {**result, "non_empty": bool(result["text"].strip())}


def multi_turn_test():
    messages = [
        {"role": "system", "content": "You are a helpful coding assistant. Answer briefly."},
        {"role": "user", "content": "I am building a Node.js CLI with yargs. Where do I define the commands?"},
        {"role": "assistant", "content": "Define them with yargs.command() in the file that builds the parser."},
        {"role": "user", "content": "And how do I add a required --name option to one of them?"},
    ]
    result = generate(messages=messages, max_new_tokens=128)
    return {**result, "non_empty": bool(result["text"].strip())}


def persian_test():
    messages = [
        {"role": "system", "content": "شما یک دستیار برنامه‌نویسی هستید. کوتاه پاسخ بدهید."},
        {
            "role": "user",
            "content": "چطور در Tailwind CSS یک چیدمان راست‌به‌چپ (RTL) بسازم؟",
        },
    ]
    result = generate(messages=messages, max_new_tokens=160)
    persian = re.findall(r"[\u0600-\u06FF]", result["text"])
    return {
        **result,
        "non_empty": bool(result["text"].strip()),
        "persian_characters": len(persian),
        "persian_ratio": round(len(persian) / max(1, len(result["text"])), 3),
    }


def coding_test():
    messages = [
        {
            "role": "system",
            "content": "You write small, complete JavaScript files. Return only code.",
        },
        {
            "role": "user",
            "content": "Write a Node.js function that reads a JSON file with fs and returns its parsed contents, throwing on invalid JSON. One file, no explanation.",
        },
    ]
    result = generate(messages=messages, max_new_tokens=200)
    text = result["text"]
    return {
        **result,
        "has_function": "function" in text or "=>" in text,
        "uses_fs": "fs" in text,
        "has_parse": "JSON.parse" in text,
        "has_code_fence": "```" in text,
    }


CHECKS = {
    "01_download": download_test,
    "02_tokenizer_init": tokenizer_test,
    "03_model_init": model_test,
    "04_text_completion": plain_completion_test,
    "05_chat_style": chat_test,
    "06_multi_turn": multi_turn_test,
    "07_persian": persian_test,
    "08_english_coding": coding_test,
    "09_structured_output": structured_test,
    "10_long_context": long_context_test,
    "11_repeated_generation": repeated_test,
    "12_tool_call_format": tool_call_test,
}


def cause(exception):
    """A short label for the class of failure, so the report is readable without the traceback."""
    import torch

    text = f"{type(exception).__name__}: {exception}"
    if isinstance(exception, torch.cuda.OutOfMemoryError):
        return "cuda-out-of-memory"
    if "out of memory" in text.lower():
        return "out-of-memory"
    if isinstance(exception, KeyError):
        return "missing-key (checkpoint field or template variable)"
    if "chat_template" in text and isinstance(exception, (ValueError, TypeError)):
        return "chat-template-incompatible-payload"
    return type(exception).__name__


def main():
    tokenizer, model, load_info = load()
    del tokenizer, model

    results = {}
    for name, check in CHECKS.items():
        started = time.time()
        try:
            results[name] = {"status": "pass", "result": check(), "seconds": round(time.time() - started, 2)}
        except Exception as exception:  # noqa: BLE001 - a failing check is itself the measured result
            results[name] = {
                "status": "fail",
                "cause": cause(exception),
                "error": f"{type(exception).__name__}: {exception}",
                "traceback": traceback.format_exc(),
                "seconds": round(time.time() - started, 2),
            }

    passed = sum(1 for item in results.values() if item["status"] == "pass")
    report = {
        "status": "measured",
        "model": MODEL,
        "revision": results["01_download"]["result"]["sha"]
        if results["01_download"]["status"] == "pass"
        else None,
        "runtime": {
            "python": platform.python_version(),
            "torch": __import__("torch").__version__,
            "transformers": __import__("transformers").__version__,
            "device": load_info["device"],
            "dtype": load_info["dtype"],
            "gpu": __import__("torch").cuda.get_device_name(0)
            if __import__("torch").cuda.is_available()
            else "cpu",
        },
        "checks": len(results),
        "passed": passed,
        "failed": len(results) - passed,
        "results": results,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(report, ensure_ascii=False))
    print("OLIVE_JSON_END")
    print(f"\n{passed}/{len(results)} checks passed", flush=True)


if __name__ == "__main__":
    main()
