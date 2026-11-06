"""Trains one controlled LoRA adapter on LFM2.5-350M on the Colab T4 session.

The run is deliberately small and fully reported: rank 16, alpha 32, dropout 0.05, sequence length 1024, learning rate
2e-4, three epochs over the exported SFT split, and loss on the assistant target only. Every number in the JSON output
comes from this run; nothing is carried over from an earlier session.

    colab-env.sh upload olivellm/datasets/processed/sft-train.jsonl /content/sft-train.jsonl -s olive-lfm-gpu
    colab-env.sh upload olivellm/datasets/processed/sft-validation.jsonl /content/sft-validation.jsonl -s olive-lfm-gpu
    colab-env.sh exec -s olive-lfm-gpu -f olivellm/scripts/colab/train_lora.py --timeout 3000

The adapter lands in OLIVE_ADAPTER (default /content/olive-lora-adapter) and the report in OLIVE_OUT.
"""

import json
import os
import time
import traceback

MODEL = "LiquidAI/LFM2.5-350M"
DATA = os.environ.get("OLIVE_DATA", "/content/sft-train.jsonl")
VALIDATION = os.environ.get("OLIVE_VAL", "/content/sft-validation.jsonl")
OUT = os.environ.get("OLIVE_OUT", "/content/olive-lora-train.json")
ADAPTER = os.environ.get("OLIVE_ADAPTER", "/content/olive-lora-adapter")
SEQUENCE = int(os.environ.get("OLIVE_SEQUENCE", "1024"))
EPOCHS = int(os.environ.get("OLIVE_EPOCHS", "3"))
ACCUMULATE = int(os.environ.get("OLIVE_ACCUMULATE", "8"))
LEARNING_RATE = float(os.environ.get("OLIVE_LR", "2e-4"))
RANK = 16
ALPHA = 32
DROPOUT = 0.05
VALIDATION_RECORDS = int(os.environ.get("OLIVE_VALIDATION_RECORDS", "24"))

# w1/w2/w3 are this architecture's MLP projections. The regex deliberately excludes the 10 causal-conv `out_proj`
# blocks: `.*self_attn\.out_proj$` only matches the six attention output projections.
TARGETS = ["q_proj", "k_proj", "v_proj", "w1", "w2", "w3", r"re:.*self_attn\.out_proj$"]

# Chosen so the assistant-only mask is computed against the same text the corpus was verified with.
MAX_SEQUENCE = SEQUENCE


def read_records(path, count=None):
    records = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            if isinstance(record.get("text"), str) and isinstance(record.get("target"), str):
                records.append(record)
            if count is not None and len(records) >= count:
                break
    return records


def encode(tokenizer, record):
    """Tokenizes one record and masks everything except the assistant target.

    Returns the tensors plus whether the decoded unmasked suffix still starts with the target, so the mask is measured
    rather than assumed.
    """
    ids = tokenizer(record["text"], truncation=True, max_length=MAX_SEQUENCE)["input_ids"]
    target_ids = tokenizer(record["target"], add_special_tokens=False)["input_ids"]
    labels = list(ids)
    prompt_length = max(0, len(ids) - len(target_ids))
    for index in range(prompt_length):
        labels[index] = -100
    supervised = [
        token for token in ids[prompt_length:] if token != tokenizer.pad_token_id
    ]
    aligned = supervised[: len(target_ids)] == target_ids[: len(supervised)]
    return ids, labels, aligned, len(target_ids) > MAX_SEQUENCE


def main():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    device = "cuda" if torch.cuda.is_available() else "cpu"

    report = {
        "status": "measured",
        "model": MODEL,
        "device": device,
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "torch": torch.__version__,
        "transformers": __import__("transformers").__version__,
        "config": {
            "rank": RANK,
            "alpha": ALPHA,
            "dropout": DROPOUT,
            "sequence_length": SEQUENCE,
            "epochs": EPOCHS,
            "learning_rate": LEARNING_RATE,
            "gradient_accumulation": ACCUMULATE,
            "targets": TARGETS,
        },
    }

    try:
        import peft
        from peft import LoraConfig, get_peft_model

        report["peft"] = peft.__version__
    except Exception as exception:  # noqa: BLE001 - a missing dependency is the finding, not a crash to hide
        report["status"] = "failed"
        report["error"] = f"{type(exception).__name__}: {exception}"
        emit(report)
        return

    records = read_records(DATA)
    report["train_records"] = len(records)
    if not records:
        report["status"] = "failed"
        report["error"] = f"no SFT records in {DATA}"
        emit(report)
        return

    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model = get_peft_model(
        model,
        LoraConfig(
            r=RANK,
            lora_alpha=ALPHA,
            lora_dropout=DROPOUT,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=TARGETS,
        ),
    )
    model.gradient_checkpointing_enable()
    model.to(device)
    model.train()

    trainable = sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)
    total = sum(parameter.numel() for parameter in model.parameters())
    report["trainable_parameters"] = trainable
    report["trainable_share"] = round(trainable / total, 6)
    report["targeted_modules"] = sorted(
        {name.split(".")[-1] for name, module in model.named_modules() if "lora_A" in name}
    )

    optimizer = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=LEARNING_RATE)
    if torch.cuda.is_available():
        torch.cuda.reset_peak_memory_stats()

    started = time.time()
    losses = []
    window = []
    step_times = []
    misaligned = 0
    truncated_targets = 0
    supervised_tokens = 0
    optimizer_steps = 0

    for epoch in range(EPOCHS):
        for position, record in enumerate(records):
            ids, labels, aligned, truncated = encode(tokenizer, record)
            misaligned += 0 if aligned else 1
            truncated_targets += 1 if truncated else 0
            supervised_tokens += sum(1 for label in labels if label != -100)
            step_started = time.time()
            output = model(
                input_ids=torch.tensor([ids], device=device),
                attention_mask=torch.ones((1, len(ids)), dtype=torch.long, device=device),
                labels=torch.tensor([labels], device=device),
            )
            (output.loss / ACCUMULATE).backward()
            window.append(float(output.loss.detach()))

            last = position == len(records) - 1
            if (position + 1) % ACCUMULATE == 0 or last:
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)
                optimizer_steps += 1
                losses.append(round(sum(window) / len(window), 4))
                window = []
                step_times.append(round(time.time() - step_started, 2))
                if optimizer_steps % 10 == 0 or last:
                    print(f"epoch {epoch + 1} step {optimizer_steps} loss {losses[-1]}", flush=True)
                    report.setdefault("loss_curve", []).append(
                        {"epoch": epoch + 1, "step": optimizer_steps, "loss": losses[-1]}
                    )
        report.setdefault("epoch_loss", []).append(
            round(sum(losses[-max(1, len(records) // ACCUMULATE) :]) / max(1, len(records) // ACCUMULATE), 4)
        )

    report["train_seconds"] = round(time.time() - started, 1)
    report["optimizer_steps"] = optimizer_steps
    report["supervised_tokens"] = supervised_tokens
    report["target_alignment_mismatches"] = misaligned
    report["records_with_truncated_target"] = truncated_targets
    report["step_seconds_mean"] = round(sum(step_times) / max(1, len(step_times)), 2)
    report["final_batch_loss"] = losses[-1] if losses else None
    report["validation"] = validate(model, tokenizer, device, torch)
    report["peak_gpu_memory_mb"] = (
        round(torch.cuda.max_memory_allocated() / 1024**2, 1) if torch.cuda.is_available() else None
    )

    model.save_pretrained(ADAPTER)
    report["adapter_path"] = ADAPTER
    emit(report)


def validate(model, tokenizer, device, torch):
    """Loss on the exported validation split, computed without gradients on the same masked targets."""
    import math

    records = read_records(VALIDATION, VALIDATION_RECORDS)
    if not records:
        return {"records": 0}
    model.eval()
    totals = []
    with torch.no_grad():
        for record in records:
            ids, labels, _, _ = encode(tokenizer, record)
            output = model(
                input_ids=torch.tensor([ids], device=device),
                attention_mask=torch.ones((1, len(ids)), dtype=torch.long, device=device),
                labels=torch.tensor([labels], device=device),
            )
            totals.append(float(output.loss.detach()))
    model.train()
    mean = sum(totals) / len(totals)
    return {
        "records": len(records),
        "mean_loss": round(mean, 4),
        "perplexity": round(math.exp(mean), 2),
    }


def emit(report):
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(report))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    try:
        main()
    except Exception as exception:  # noqa: BLE001 - a broken run is reported, never disguised as a success
        emit({"status": "failed", "error": f"{type(exception).__name__}: {exception}", "traceback": traceback.format_exc()})
