"""Runs the whole controlled experiment inside one Colab kernel and one connection.

Colab releases the runtime when the client disconnects, so a sequence of separate `colab exec` calls loses `/content`
between stages. This driver runs every stage in one process instead: the mask check, the fresh baseline, training and the
adapter evaluation share the uploaded inputs and the warm kernel, and each stage's output is captured to its own file
under /content/results as well as being reported in the final JSON document.

A failed stage is recorded and stops the stages that depend on it; the mask check failing stops everything, because
training on an unverified mask is the one outcome this repository does not allow.

    colab exec -s <session> -f /content/run_all.py --timeout 7200
"""

import io
import json
import os
import sys
import time
import traceback
from contextlib import redirect_stdout

sys.path.insert(0, "/content")

RESULTS = "/content/results"
ADAPTER = os.environ.get("OLIVE_ADAPTER", "/content/olive-lora-adapter")
os.makedirs(RESULTS, exist_ok=True)

import train_lora  # noqa: E402 - after the path and directory are ready


def documents(text):
    """The marker-delimited JSON a stage printed, if it printed one."""
    import re

    found = re.findall(r"OLIVE_JSON_BEGIN\s*\n(.*?)\nOLIVE_JSON_END", text, re.S)
    documents = []
    for block in found:
        try:
            documents.append(json.loads(block))
        except json.JSONDecodeError:
            continue
    return documents


def stage(name, function):
    buffer = io.StringIO()
    started = time.time()
    record = {"stage": name, "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(started))}
    print(f"[stage] {name}: starting", flush=True)
    try:
        with redirect_stdout(buffer):
            function()
    except BaseException as error:  # noqa: BLE001 - every failure is a result the caller needs
        record["status"] = "failed"
        record["error"] = f"{type(error).__name__}: {error}"
        record["traceback"] = traceback.format_exc()
    else:
        record["status"] = "ok"
    record["seconds"] = round(time.time() - started, 1)
    text = buffer.getvalue()
    with open(os.path.join(RESULTS, f"{name}.log"), "w", encoding="utf-8") as handle:
        handle.write(text)
    record["documents"] = documents(text)
    with open(os.path.join(RESULTS, f"{name}.json"), "w", encoding="utf-8") as handle:
        json.dump(record, handle, indent=1)
    print(f"[stage] {name}: {record['status']} in {record['seconds']}s", flush=True)
    return record


def mask():
    import test_masking

    test_masking.main()


def baseline():
    # The adapter is read from the environment, and a kernel that already ran the adapter stage keeps it set. Without
    # this the baseline of a rerun would measure the fine-tuned model and report it as the base checkpoint.
    os.environ.pop("OLIVE_ADAPTER", None)
    import evaluate

    evaluate.main()


def train():
    train_lora.main()


def adapter():
    os.environ["OLIVE_ADAPTER"] = ADAPTER
    import evaluate

    evaluate.main()


def main():
    stages = []
    masking = stage("mask", mask)
    stages.append(masking)
    if masking["status"] != "ok":
        print("[stage] mask check failed; training is not started", flush=True)
    else:
        for record in (stage("baseline", baseline), stage("train", train)):
            stages.append(record)
            if record["status"] != "ok":
                print(f"[stage] {record['stage']} failed; dependent stages are skipped", flush=True)
                break
        else:
            stages.append(stage("adapter", adapter))

    summary = {
        "status": "completed" if all(record["status"] == "ok" for record in stages) else "incomplete",
        "stages": [
            {key: value for key, value in record.items() if key != "documents"} for record in stages
        ],
        "base": next((record["documents"][0] for record in stages if record["stage"] == "baseline" and record["documents"]), None),
        "training": train_lora_report(stages),
        "adapter": next((record["documents"][0] for record in stages if record["stage"] == "adapter" and record["documents"]), None),
        "mask": next((record["documents"][0] for record in stages if record["stage"] == "mask" and record["documents"]), None),
    }
    with open(os.path.join(RESULTS, "summary.json"), "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=1)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps(summary))
    print("OLIVE_JSON_END")


def train_lora_report(stages):
    for record in stages:
        if record["stage"] != "train":
            continue
        if record["documents"]:
            return record["documents"][0]
        path = train_lora.OUT
        if os.path.exists(path):
            with open(path, encoding="utf-8") as handle:
                return json.load(handle)
        return {"status": record["status"], "error": record.get("error")}
    return None


if __name__ == "__main__":
    main()
