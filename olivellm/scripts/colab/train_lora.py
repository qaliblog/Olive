"""Trains one controlled LoRA adapter on LFM2.5-350M for the Olive coding agent.

This is the only script in the pipeline that decides which tokens the loss is computed on, so it refuses to guess. The
supervisor mask is a verified slice of the exported record: the target must be the assistant content immediately before
the closing `<|im_end|>`, the prompt prefix must tokenize to a genuine token prefix of the full sequence, and the
assistant turn must tokenize identically on its own. Any deviation aborts before a single optimizer step, because a mask
placed by arithmetic on character or token lengths trains the model on the prompt or drops the target silently.

Truncation only ever removes prompt tokens from the front, so the newest state and the whole assistant turn survive. A
record whose assistant turn alone exceeds the sequence length is skipped and reported; a run that would have to truncate
the prompt for more than `OLIVE_MAX_PROMPT_TRUNCATION` of its records aborts, because that run would be training without
the tool list it is supposed to learn from.

Every value the run used is written to the report next to the measurements, including the sequence length, so a
deviation from the research plan is visible rather than implied. Training checkpoints each `OLIVE_SAVE_EVERY` optimizer
steps and can resume with `OLIVE_RESUME=1`; resumed runs restart the AdamW moments and say so in the report.

    colab exec -s <session> -f olivellm/scripts/colab/train_lora.py --timeout 3600

Environment:
    OLIVE_DATA, OLIVE_VAL, OLIVE_EVAL_IDS, OLIVE_OUT, OLIVE_ADAPTER   paths
    OLIVE_SEQUENCE, OLIVE_EPOCHS, OLIVE_ACCUMULATE, OLIVE_LR          optimization
    OLIVE_RANK, OLIVE_ALPHA, OLIVE_DROPOUT, OLIVE_TARGETS             adapter
    OLIVE_SEED, OLIVE_SAVE_EVERY, OLIVE_RESUME                        reproducibility
    OLIVE_MAX_PROMPT_TRUNCATION                                       truncation budget (share of records)
"""

import hashlib
import json
import math
import os
import random
import time
import traceback

MODEL = "LiquidAI/LFM2.5-350M"
IM_END = "<|im_end|>"
ASSISTANT = "<|im_start|>assistant\n"

TRAIN = os.environ.get("OLIVE_DATA", "/content/sft-train.jsonl")
VALIDATION = os.environ.get("OLIVE_VAL", "/content/sft-validation.jsonl")
EVAL_IDS = os.environ.get("OLIVE_EVAL_IDS", "/content/eval-ids.json")
OUT = os.environ.get("OLIVE_OUT", "/content/olive-lora-train.json")
ADAPTER = os.environ.get("OLIVE_ADAPTER", "/content/olive-lora-adapter")

# The research plan's configuration. These are read from the environment only so the same script can be rerun with a
# recorded deviation; anything that differs is reported with the run.
SEQUENCE = int(os.environ.get("OLIVE_SEQUENCE", "1024"))
EPOCHS = int(os.environ.get("OLIVE_EPOCHS", "3"))
ACCUMULATE = int(os.environ.get("OLIVE_ACCUMULATE", "8"))
LEARNING_RATE = float(os.environ.get("OLIVE_LR", "2e-4"))
RANK = int(os.environ.get("OLIVE_RANK", "16"))
ALPHA = int(os.environ.get("OLIVE_ALPHA", "32"))
DROPOUT = float(os.environ.get("OLIVE_DROPOUT", "0.05"))
TARGETS = [
    item.strip()
    for item in os.environ.get("OLIVE_TARGETS", r"q_proj,k_proj,v_proj,w1,w2,w3,re:.*self_attn\.out_proj$").split(",")
    if item.strip()
]
SEED = int(os.environ.get("OLIVE_SEED", "20261106"))
SAVE_EVERY = int(os.environ.get("OLIVE_SAVE_EVERY", "20"))
RESUME = os.environ.get("OLIVE_RESUME", "0") == "1"
MAX_PROMPT_TRUNCATION = float(os.environ.get("OLIVE_MAX_PROMPT_TRUNCATION", "0.10"))


class AlignmentError(RuntimeError):
    """The supervision mask cannot be placed without guessing."""


class TargetTooLong(RuntimeError):
    """The assistant turn alone does not fit the configured sequence length."""


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_records(path):
    records = []
    with open(path, encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                raise AlignmentError(f"{path}:{number}: record is not an object")
            if not isinstance(record.get("text"), str) or not isinstance(record.get("target"), str):
                raise AlignmentError(f"{path}:{number}: record needs string `text` and `target`")
            if not record["text"].strip() or not record["target"].strip():
                raise AlignmentError(f"{path}:{number}: empty text or target")
            records.append(record)
    if not records:
        raise AlignmentError(f"{path}: no records")
    return records


def assistant_ids(tokenizer, record):
    """Returns `(input ids, index of the first supervised token)` for one exported record.

    The assistant turn is located by its own content, then verified three ways: the prefix tokenizes to a prefix of the
    full sequence, the supervised suffix tokenizes the same in context as on its own, and the turn ends exactly at the
    closing `<|im_end|>`. Character arithmetic on `len(ids) - len(target_ids)` is not used anywhere: it cannot survive a
    truncated sequence or a target that shares a token with the prompt.
    """
    text = record["text"]
    target = record["target"]
    index = text.rfind(target)
    if index < 0:
        raise AlignmentError("target does not appear verbatim in text")
    tail = text[index + len(target) :]
    if tail not in (f"{IM_END}\n", IM_END):
        raise AlignmentError(f"unexpected text after the assistant turn: {tail!r}")
    if not text[:index].endswith(ASSISTANT):
        raise AlignmentError("the target is not the content of the final assistant turn")

    prefix = tokenizer(text[:index], add_special_tokens=False)["input_ids"]
    ids = tokenizer(text, add_special_tokens=False)["input_ids"]
    if ids[: len(prefix)] != prefix:
        raise AlignmentError("the prompt prefix is not a token prefix of the full sequence")

    supervised = ids[len(prefix) :]
    if not supervised:
        raise AlignmentError("zero supervised tokens")
    standalone = tokenizer(text[index:], add_special_tokens=False)["input_ids"]
    if supervised != standalone:
        raise AlignmentError("the assistant turn tokenizes differently on its own than in context")
    return ids, len(prefix)


def encode_record(tokenizer, record, sequence):
    """Encodes one record to `input_ids` and `labels`, truncating prompt tokens only."""
    ids, first = assistant_ids(tokenizer, record)
    supervised = len(ids) - first
    if supervised >= sequence:
        raise TargetTooLong(f"assistant turn is {supervised} tokens; sequence length is {sequence}")

    dropped = max(0, len(ids) - sequence)
    if dropped:
        ids = ids[dropped:]
        first -= dropped

    labels = [-100] * first + ids[first:]
    if len(labels) != len(ids) or not labels:
        raise AlignmentError("label vector does not cover the sequence")
    if all(label == -100 for label in labels):
        raise AlignmentError("every label is masked")
    if tokenizer.convert_tokens_to_ids(IM_END) not in labels[first:]:
        raise AlignmentError("the closing <|im_end|> is not supervised")
    if ids[first] == tokenizer.convert_tokens_to_ids(IM_END):
        raise AlignmentError("supervision starts at the turn terminator instead of the answer")

    return (
        {"input_ids": ids, "labels": labels},
        {"supervised": supervised, "dropped_prompt": dropped, "length": len(ids)},
    )


def prepare(tokenizer, records, sequence):
    """Encodes a split, refusing to train on a sequence whose target was cut or whose prompt was mostly thrown away."""
    examples, skipped, truncated = [], [], 0
    for record in records:
        try:
            example, stats = encode_record(tokenizer, record, sequence)
        except TargetTooLong as error:
            skipped.append({"id": record.get("id"), "reason": str(error)})
            continue
        if stats["dropped_prompt"]:
            truncated += 1
        examples.append(
            {
                **example,
                "id": record.get("id"),
                "supervised": stats["supervised"],
                "dropped_prompt": stats["dropped_prompt"],
                "length": stats["length"],
            }
        )
    if not examples:
        raise AlignmentError("no record survived encoding")
    share = truncated / len(examples)
    if share > MAX_PROMPT_TRUNCATION:
        raise AlignmentError(
            f"{truncated}/{len(examples)} records ({share:.1%}) would lose prompt tokens at sequence length {sequence}, "
            f"which is above the {MAX_PROMPT_TRUNCATION:.0%} budget; raise OLIVE_SEQUENCE instead of training without the "
            "tool list"
        )
    return examples, skipped, truncated


def percentiles(values):
    if not values:
        return None
    ordered = sorted(values)

    def at(fraction):
        return ordered[min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))]

    return {"p50": at(0.5), "p90": at(0.9), "p95": at(0.95), "max": ordered[-1], "mean": round(sum(values) / len(values), 1)}


def leakage(train_ids, validation_ids, eval_file):
    """Checks the optimizer never sees a held-out or test record, and that validation is disjoint from training."""
    report = {"train_validation_overlap": sorted(set(train_ids) & set(validation_ids))}
    if not os.path.exists(eval_file):
        report["eval_ids"] = None
        return report
    with open(eval_file, encoding="utf-8") as handle:
        groups = json.load(handle)
    if isinstance(groups, dict) and "ids" in groups:
        groups = {"heldout": groups["ids"]}
    report["eval_ids"] = {}
    for name, ids in groups.items():
        overlap = sorted(set(train_ids) & set(ids))
        report["eval_ids"][name] = {"count": len(ids), "overlap": overlap}
    return report


def build(device, dtype):
    import peft
    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=os.environ.get("HF_TOKEN"))
    base = AutoModelForCausalLM.from_pretrained(
        MODEL,
        token=os.environ.get("HF_TOKEN"),
        dtype=dtype,
    )
    base.config.use_cache = False
    base.enable_input_require_grads()

    checkpoint = os.path.join(ADAPTER, "train-state.json")
    if RESUME and os.path.exists(checkpoint):
        with open(checkpoint, encoding="utf-8") as handle:
            state = json.load(handle)
        adapter = peft.PeftModel.from_pretrained(base, os.path.join(ADAPTER, state["checkpoint"]), is_trainable=True)
    else:
        state = None
        adapter = peft.get_peft_model(
            base,
            peft.LoraConfig(
                r=RANK,
                lora_alpha=ALPHA,
                lora_dropout=DROPOUT,
                bias="none",
                task_type="CAUSAL_LM",
                target_modules=TARGETS,
            ),
        )
    adapter.to(device)
    environment = {
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "peft": peft.__version__,
        "python": os.sys.version.split()[0],
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "dtype": str(dtype).replace("torch.", ""),
    }
    return tokenizer, adapter, state, environment


def validate(adapter, examples, device):
    import torch

    if not examples:
        return None
    adapter.eval()
    losses, supervised = [], []
    with torch.no_grad():
        for example in examples:
            batch = {key: torch.tensor([value], device=device) for key, value in example.items() if key in ("input_ids", "labels")}
            losses.append(float(adapter(**batch).loss))
            supervised.append(example["supervised"])
    adapter.train()
    loss = sum(losses) / len(losses)
    return {
        "records": len(examples),
        "loss": round(loss, 4),
        "perplexity": round(math.exp(min(loss, 20)), 3),
        "supervised_tokens": sum(supervised),
    }


def main():
    import torch

    started = time.time()
    report = {
        "status": "running",
        "model": MODEL,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started)),
        "git_commit": os.environ.get("OLIVE_GIT_COMMIT"),
        "dataset": {},
        "config": {
            "sequence_length": SEQUENCE,
            "epochs": EPOCHS,
            "gradient_accumulation": ACCUMULATE,
            "learning_rate": LEARNING_RATE,
            "lora_r": RANK,
            "lora_alpha": ALPHA,
            "lora_dropout": DROPOUT,
            "target_modules": TARGETS,
            "seed": SEED,
            "effective_batch_size": ACCUMULATE,
            "optimizer": "adamw_torch",
            "scheduler": "none (constant learning rate)",
        },
    }

    report["dataset"] = {"train": TRAIN, "validation": VALIDATION}
    for name, path in (("train", TRAIN), ("validation", VALIDATION)):
        report["dataset"][f"{name}_sha256"] = sha256_file(path)

    torch.manual_seed(SEED)
    random.seed(SEED)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(SEED)
        torch.cuda.reset_peak_memory_stats()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32

    tokenizer, adapter, state, environment = build(device, dtype)
    report["environment"] = environment
    trainable = [parameter for parameter in adapter.parameters() if parameter.requires_grad]
    total = sum(parameter.numel() for parameter in adapter.parameters())
    trainable_count = sum(parameter.numel() for parameter in trainable)
    report["adapter"] = {
        "trainable_parameters": trainable_count,
        "total_parameters": total,
        "trainable_share": round(trainable_count / total, 6),
        "lora_modules": sorted(name for name, _ in adapter.named_modules() if "lora_A" in name),
    }
    report["adapter"]["lora_module_count"] = len(report["adapter"]["lora_modules"])

    train_records = read_records(TRAIN)
    validation_records = read_records(VALIDATION)
    examples, skipped, truncated = prepare(tokenizer, train_records, SEQUENCE)
    validation_examples, validation_skipped, _ = prepare(tokenizer, validation_records, SEQUENCE)
    report["leakage"] = leakage(
        [example["id"] for example in examples],
        [example["id"] for example in validation_examples],
        EVAL_IDS,
    )
    for group in (report["leakage"].get("eval_ids") or {}).values():
        if group["overlap"]:
            raise AlignmentError(f"training records overlap an evaluation split: {group['overlap'][:5]}")

    report["data"] = {
        "train_records": len(train_records),
        "train_examples": len(examples),
        "train_skipped": skipped,
        "train_prompt_truncated": truncated,
        "validation_records": len(validation_records),
        "validation_examples": len(validation_examples),
        "validation_skipped": validation_skipped,
        "supervised_tokens": sum(example["supervised"] for example in examples),
        "sequence_tokens": percentiles([example["length"] for example in examples]),
        "supervised_tokens_per_example": percentiles([example["supervised"] for example in examples]),
        "prompt_tokens": percentiles([example["length"] - example["supervised"] for example in examples]),
        "tool_call_targets": sum(1 for record in train_records if "<|tool_call_start|>" in record["target"]),
        "languages": {},
    }
    for record in train_records:
        language = record.get("language", "unknown")
        report["data"]["languages"][language] = report["data"]["languages"].get(language, 0) + 1

    optimizer = torch.optim.AdamW(trainable, lr=LEARNING_RATE)
    completed = int(state["completed_examples"]) if state else 0
    report["resumed_from"] = state["checkpoint"] if state else None

    order = list(range(len(examples)))
    torch.manual_seed(SEED + completed)
    random.shuffle(order)
    remaining = order[completed:]

    curve, epoch_losses, steps = [], [], 0
    adapter.train()
    window = []
    epoch = completed // len(examples) if examples else 0
    position = completed

    def save(tag):
        directory = os.path.join(ADAPTER, tag)
        adapter.save_pretrained(directory)
        with open(os.path.join(ADAPTER, "train-state.json"), "w", encoding="utf-8") as handle:
            json.dump({"completed_examples": position, "checkpoint": tag, "epoch": epoch, "step": steps}, handle)

    report["optimizer_steps_expected"] = math.ceil(len(examples) * EPOCHS / ACCUMULATE)

    while position < len(examples) * EPOCHS:
        index = order[position % len(examples)]
        example = examples[index]
        batch = {
            "input_ids": torch.tensor([example["input_ids"]], device=device),
            "labels": torch.tensor([example["labels"]], device=device),
        }
        loss = adapter(**batch).loss
        if not math.isfinite(float(loss)):
            raise AlignmentError(f"non-finite loss at example {position}")
        (loss / ACCUMULATE).backward()
        window.append(float(loss))
        position += 1
        finished = position >= len(examples) * EPOCHS
        if len(window) == ACCUMULATE or finished:
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            steps += 1
            mean = sum(window) / len(window)
            curve.append(round(mean, 4))
            epoch_losses.append(mean)
            window = []
            if steps % 10 == 0 or finished:
                print(f"step {steps}: loss {mean:.4f} ({position}/{len(examples) * EPOCHS} examples)", flush=True)
            if steps % SAVE_EVERY == 0 and not finished:
                save(f"checkpoint-{steps}")
        if position % len(examples) == 0:
            epoch = position // len(examples)
            save("checkpoint-epoch")
            report.setdefault("validation", []).append({"epoch": epoch, **validate(adapter, validation_examples, device)})
            epoch_losses = []

    elapsed = time.time() - started
    adapter.save_pretrained(ADAPTER)
    tokenizer.save_pretrained(ADAPTER)
    with open(os.path.join(ADAPTER, "training-config.json"), "w", encoding="utf-8") as handle:
        json.dump({**report["config"], "base_model": MODEL, "git_commit": report["git_commit"]}, handle, indent=2)

    report["results"] = {
        "status": "completed",
        "epochs_completed": EPOCHS,
        "optimizer_steps": steps,
        "final_loss": curve[-1] if curve else None,
        "mean_loss_first_10_steps": round(sum(curve[:10]) / len(curve[:10]), 4) if curve else None,
        "mean_loss_last_10_steps": round(sum(curve[-10:]) / len(curve[-10:]), 4) if curve else None,
        "loss_curve": curve,
        "duration_seconds": round(elapsed, 1),
        "seconds_per_optimizer_step": round(elapsed / steps, 2) if steps else None,
        "examples_per_second": round(position / elapsed, 2) if elapsed else None,
        "peak_gpu_memory_mb": round(torch.cuda.max_memory_allocated() / 1024**2, 1) if torch.cuda.is_available() else None,
        "adapter_directory": ADAPTER,
        "adapter_files": sorted(os.listdir(ADAPTER)),
    }
    report["status"] = "completed"
    report["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(report))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # noqa: BLE001 - the report is the diagnostic the caller reads
        failure = {
            "status": "failed",
            "error": f"{type(error).__name__}: {error}",
            "traceback": traceback.format_exc(),
        }
        with open(OUT, "w", encoding="utf-8") as handle:
            json.dump(failure, handle, indent=2)
        print("OLIVE_JSON_BEGIN")
        print(json.dumps(failure))
        print("OLIVE_JSON_END")
        raise SystemExit(1) from error
