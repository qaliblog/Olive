"""LoRA compatibility and feasibility smoke test for LFM2.5-350M on the live Colab session.

Answers what a training plan needs and what guesses cannot provide: the linear module names LoRA can target, the
trainable-parameter share for a rank-16 adapter, whether gradient checkpointing works on this architecture, and the
peak VRAM and step time of a real backward pass at a fixed sequence length.

Nothing is trained to convergence. Three optimizer steps on four real records from the exported SFT split is enough to
prove the path runs and to measure its cost; a longer run is a separate decision.

    colab-env.sh upload olivellm/datasets/processed/sft-train.jsonl /content/sft-train.jsonl -s olive-lfm-gpu
    colab-env.sh exec -s olive-lfm-gpu -f olivellm/scripts/colab/lora_probe.py --timeout 1500
"""

import collections
import json
import os
import time
import traceback

MODEL = "LiquidAI/LFM2.5-350M"
DATA = os.environ.get("OLIVE_DATA", "/content/sft-train.jsonl")
OUT = os.environ.get("OLIVE_OUT", "/content/olive-lora.json")
SEQUENCE = int(os.environ.get("OLIVE_SEQUENCE", "512"))
BATCH = int(os.environ.get("OLIVE_BATCH", "2"))
STEPS = int(os.environ.get("OLIVE_STEPS", "3"))
RANK = 16
ALPHA = 32


def read_records(count):
    records = []
    with open(DATA, encoding="utf-8") as handle:
        for line in handle:
            if len(records) >= count:
                break
            record = json.loads(line)
            if isinstance(record.get("text"), str) and isinstance(record.get("target"), str):
                records.append(record)
    return records


def main():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    device = "cuda" if torch.cuda.is_available() else "cpu"

    started = time.time()
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model.to(device)
    load_seconds = time.time() - started

    inventory = collections.Counter()
    linear_names = []
    for name, module in model.named_modules():
        if isinstance(module, torch.nn.Linear):
            inventory[name.split(".")[-1]] += 1
            linear_names.append(name)

    report = {
        "status": "measured",
        "model": MODEL,
        "device": device,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "torch": torch.__version__,
        "transformers": __import__("transformers").__version__,
        "load_seconds": round(load_seconds, 2),
        "base_parameters": sum(parameter.numel() for parameter in model.parameters()),
        "linear_suffix_counts": dict(inventory),
        "linear_module_examples": linear_names[:12],
        "lora": {"rank": RANK, "alpha": ALPHA},
        "sequence_length": SEQUENCE,
        "batch_size": BATCH,
    }

    try:
        import peft
        from peft import LoraConfig, get_peft_model

        report["peft"] = peft.__version__
    except Exception as exception:  # noqa: BLE001 - the missing dependency is the finding
        report["status"] = "failed"
        report["peft_error"] = f"{type(exception).__name__}: {exception}"
        emit(report)
        return

    # Attention projections are the conservative first target; the conv blocks carry their own in/out projections and
    # the MLP has gate/up/down, which a second run can add.
    attention = ["q_proj", "k_proj", "v_proj", "o_proj"]
    targets = [suffix for suffix in attention if inventory.get(suffix)]
    report["target_modules"] = targets

    try:
        report["gradient_checkpointing"] = run_training(
            torch, model, tokenizer, device, targets, report
        )
    except Exception as exception:  # noqa: BLE001 - a broken path is recorded, not hidden
        report["status"] = "failed"
        report["error"] = f"{type(exception).__name__}: {exception}"
        report["traceback"] = traceback.format_exc()
    emit(report)


def run_training(torch, model, tokenizer, device, targets, report):
    """One real LoRA adapter, three real steps, measured memory and loss."""
    from peft import LoraConfig, get_peft_model

    records = read_records(BATCH * STEPS)
    report["records"] = len(records)
    if len(records) < BATCH:
        raise RuntimeError(f"expected at least {BATCH} SFT records in the uploaded file, found {len(records)}")

    model = get_peft_model(
        model,
        LoraConfig(
            r=RANK,
            lora_alpha=ALPHA,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=targets,
        ),
    )
    trainable = sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)
    total = sum(parameter.numel() for parameter in model.parameters())
    report["trainable_parameters"] = trainable
    report["trainable_share"] = round(trainable / total, 5)

    checkpointing = {"supported": True}
    try:
        model.gradient_checkpointing_enable()
    except Exception as exception:  # noqa: BLE001
        checkpointing = {"supported": False, "error": f"{type(exception).__name__}: {exception}"}
    model.train()
    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-4)

    batches = []
    for index in range(0, len(records) - BATCH + 1, BATCH):
        batch = records[index : index + BATCH]
        texts = [record["text"] for record in batch]
        encoded = tokenizer(
            texts,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=SEQUENCE,
        )
        labels = encoded["input_ids"].clone()
        for row, record in enumerate(batch):
            target_ids = tokenizer(record["target"], add_special_tokens=False)["input_ids"]
            prompt_length = max(0, int(encoded["attention_mask"][row].sum()) - len(target_ids))
            labels[row, :prompt_length] = -100
        labels[encoded["attention_mask"] == 0] = -100
        batches.append((encoded["input_ids"].to(device), encoded["attention_mask"].to(device), labels.to(device)))

    losses = []
    step_times = []
    for batch_index, (input_ids, attention_mask, labels) in enumerate(batches[:STEPS]):
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        started = time.time()
        output = model(input_ids=input_ids, attention_mask=attention_mask, labels=labels)
        output.loss.backward()
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)
        if torch.cuda.is_available():
            torch.cuda.synchronize()
        step_times.append(round(time.time() - started, 2))
        losses.append(round(float(output.loss.detach()), 4))
        if batch_index == 0:
            report["first_step_peak_gpu_memory_mb"] = (
                round(torch.cuda.max_memory_allocated() / 1024**2, 1) if torch.cuda.is_available() else None
            )

    report["steps"] = len(losses)
    report["losses"] = losses
    report["step_seconds"] = step_times
    report["tokens_per_step"] = BATCH * SEQUENCE
    report["tokens_per_second"] = round(
        len(losses) * BATCH * SEQUENCE / max(sum(step_times), 1e-9), 1
    )
    report["peak_gpu_memory_mb"] = round(torch.cuda.max_memory_allocated() / 1024**2, 1) if torch.cuda.is_available() else None
    return checkpointing


def emit(report):
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(report))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
