"""Tests the supervisor mask against the real LFM2.5 tokenizer and the real exported records.

`bun test` cannot tokenize, so the mask contract that `train_lora.py` enforces is exercised here, on Colab, before any
training starts: every record must align, the closing `<|im_end|>` must be supervised, truncation must keep the whole
assistant turn, and the decoded supervised span must read back as the assistant answer for ordinary replies, native tool
calls, calls with arguments, and Persian and mixed-language records.

    colab exec -s <session> -f olivellm/scripts/colab/test_masking.py --timeout 1800

The length budget section reports how many records fit a given sequence length, which is the measurement the run's
sequence length has to be justified against.
"""

import json
import os
import sys
import traceback

sys.path.insert(0, os.environ.get("OLIVE_SCRIPTS", "/content"))

import train_lora  # noqa: E402 - needs the path above

MODEL = train_lora.MODEL
TRAIN = train_lora.TRAIN
VALIDATION = train_lora.VALIDATION
BUDGETS = [1024, 1536, 2048, 3072, 4096]


def main():
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=os.environ.get("HF_TOKEN"))
    eos = tokenizer.convert_tokens_to_ids(train_lora.IM_END)
    train = train_lora.read_records(TRAIN)
    validation = train_lora.read_records(VALIDATION)

    results = []
    failures = []

    def check(name, function):
        try:
            results.append({"test": name, "status": "pass", "detail": function()})
        except Exception as error:  # noqa: BLE001 - every failure is a finding
            failures.append({"test": name, "status": "fail", "error": f"{type(error).__name__}: {error}", "traceback": traceback.format_exc()})

    def align(records):
        spans = [train_lora.assistant_ids(tokenizer, record) for record in records]
        return {
            "records": len(spans),
            "supervised_tokens": {
                "min": min(len(ids) - first for ids, first in spans),
                "max": max(len(ids) - first for ids, first in spans),
            },
        }

    def pick(predicate, records=train):
        found = next((record for record in records if predicate(record)), None)
        if found is None:
            raise AssertionError("no record matches the fixture predicate")
        return found

    def supervised_text(record, sequence=4096):
        example, _ = train_lora.encode_record(tokenizer, record, sequence)
        first = next(index for index, label in enumerate(example["labels"]) if label != -100)
        return tokenizer.decode(example["input_ids"][first:], skip_special_tokens=False), example

    def boundary(record):
        example, stats = train_lora.encode_record(tokenizer, record, 4096)
        first = len(example["labels"]) - stats["supervised"]
        assert example["labels"][:first] == [-100] * first, "prompt tokens were not masked"
        assert example["labels"][first:] == example["input_ids"][first:], "assistant tokens were masked"
        assert example["input_ids"][first] == tokenizer(record["target"], add_special_tokens=False)["input_ids"][0], (
            "supervision does not start at the target's first token"
        )
        return {"supervised": stats["supervised"], "first_token": example["input_ids"][first]}

    def multilingual(language):
        record = pick(lambda item: item.get("language") == language and "<|tool_call_start|>" not in item["target"])
        text, _ = supervised_text(record)
        assert text.startswith(record["target"]), "decoded supervision does not start at the target"
        assert eos in tokenizer(text, add_special_tokens=False)["input_ids"], "the turn terminator is not supervised"
        return {"id": record["id"], "language": language, "decoded_characters": len(text)}

    check("training split aligns end to end", lambda: align(train))
    check("validation split aligns end to end", lambda: align(validation))

    check(
        "ordinary assistant response is supervised from its first content token",
        lambda: {
            "id": pick(lambda item: "<|tool_call_start|>" not in item["target"])["id"],
            **boundary(pick(lambda item: "<|tool_call_start|>" not in item["target"])),
        },
    )
    check(
        "native tool call is supervised including both control tokens",
        lambda: {
            "id": pick(lambda item: "<|tool_call_start|>" in item["target"])["id"],
            "has_end_token": "<|tool_call_end|>" in supervised_text(pick(lambda item: "<|tool_call_start|>" in item["target"]))[0],
            **boundary(pick(lambda item: "<|tool_call_start|>" in item["target"])),
        },
    )
    check(
        "tool arguments survive supervision",
        lambda: {
            "id": pick(lambda item: any(len(call.get("arguments") or {}) >= 2 for call in item["messages"][-1].get("toolCalls") or []))["id"],
            **boundary(pick(lambda item: any(len(call.get("arguments") or {}) >= 2 for call in item["messages"][-1].get("toolCalls") or []))),
        },
    )
    check("persian record supervision decodes as persian", lambda: multilingual("fa"))
    check("mixed-language record supervision decodes", lambda: multilingual("mixed"))

    def eos_everywhere():
        missing = [
            record["id"]
            for record in train
            if eos
            not in train_lora.encode_record(tokenizer, record, 4096)[0]["labels"]
        ]
        assert not missing, f"{len(missing)} records do not supervise the closing token, first: {missing[:3]}"
        return {"records": len(train), "eos_token_id": eos}

    check("the closing <|im_end|> is supervised in every record", eos_everywhere)

    def truncation():
        record = max(train, key=lambda item: len(train_lora.assistant_ids(tokenizer, item)[0]))
        full, full_stats = train_lora.encode_record(tokenizer, record, 4096)
        sequence = max(full_stats["supervised"] + 64, 256)
        cut, cut_stats = train_lora.encode_record(tokenizer, record, sequence)
        assert len(cut["input_ids"]) <= sequence, "sequence length was not enforced"
        assert cut_stats["supervised"] == full_stats["supervised"], "truncation changed the supervised span"
        assert eos in cut["labels"], "truncation dropped the turn terminator"
        assert cut["labels"][-1] != -100, "truncation left the last token unsupervised"
        assert cut["input_ids"][-1] == cut["input_ids"][-1] and cut["labels"].count(-100) == len(cut["input_ids"]) - cut_stats["supervised"], (
            "the mask does not cover exactly the assistant turn"
        )
        assert cut_stats["dropped_prompt"] == len(full["input_ids"]) - len(cut["input_ids"])
        try:
            train_lora.encode_record(tokenizer, record, cut_stats["supervised"])
        except train_lora.TargetTooLong:
            pass
        else:
            raise AssertionError("a sequence shorter than the assistant turn was accepted")
        return {
            "id": record["id"],
            "full_tokens": len(full["input_ids"]),
            "sequence": sequence,
            "dropped_prompt_tokens": cut_stats["dropped_prompt"],
            "supervised": cut_stats["supervised"],
        }

    check("truncation keeps the assistant turn and only cuts the prompt", truncation)

    def budget():
        lengths = []
        for record in train:
            try:
                example, stats = train_lora.encode_record(tokenizer, record, 32768)
            except train_lora.TargetTooLong:
                continue
            lengths.append((len(example["input_ids"]), stats["supervised"]))
        report = {}
        for sequence in BUDGETS:
            trimmed = sum(1 for length, _ in lengths if length > sequence)
            supervised_ok = sum(1 for length, supervised in lengths if supervised < sequence)
            report[str(sequence)] = {
                "records_needing_prompt_truncation": trimmed,
                "share": round(trimmed / len(lengths), 3),
                "records_where_the_target_fits": supervised_ok,
            }
        return {"records": len(lengths), "budgets": report, "length_tokens": train_lora.percentiles([length for length, _ in lengths])}

    check("sequence length budget", budget)

    examples = []
    for record in [
        pick(lambda item: item.get("language") == "en" and "<|tool_call_start|>" not in item["target"]),
        pick(lambda item: item.get("language") == "fa" and "<|tool_call_start|>" in item["target"]),
        pick(lambda item: item.get("language") == "mixed"),
    ]:
        text, example = supervised_text(record)
        first = len(example["labels"]) - sum(1 for label in example["labels"] if label != -100)
        examples.append(
            {
                "id": record["id"],
                "language": record.get("language"),
                "prompt_tail": tokenizer.decode(example["input_ids"][:first][-60:], skip_special_tokens=False),
                "supervised_tokens": len(example["input_ids"]) - first,
                "supervised_text": text[:400],
            }
        )

    summary = {"model": MODEL, "tests": results, "failures": failures, "examples": examples}
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(summary))
    print("OLIVE_JSON_END")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
