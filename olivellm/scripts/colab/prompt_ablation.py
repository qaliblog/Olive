"""Isolates why the frozen evaluation cases produce no tool call while a short probe produces one.

The frozen baseline was reproduced byte-count for byte-count on this session (71 cases, 5020 output tokens, 0 call
blocks), so the checkpoint is not the explanation. This keeps the model and the decoding fixed and varies only what the
evaluation case actually contains: its system message, its tool list, and its last user message.

Conditions, all greedy with max_new_tokens=192 to match the frozen run:

  1. as_is        - the case exactly as evaluated, all tools, its own system message
  2. imperative   - same, plus "use a tool now" appended to the last user message
  3. trimmed_tools- same, but only the tool the case expects
  4. minimal_sys  - same, but the system message replaced by a two-line agent instruction
  5. no_system    - the system message dropped entirely

    colab-env.sh exec -s olive-lfm-gpu -f olivellm/scripts/colab/prompt_ablation.py --timeout 1500
"""

import json
import os
import re
import time

MODEL = "LiquidAI/LFM2.5-350M"
CASES = os.environ.get("OLIVE_CASES", "/content/cases.json")
OUT = os.environ.get("OLIVE_OUT", "/content/olive-ablation.json")
LIMIT = int(os.environ.get("OLIVE_LIMIT", "8"))
BLOCK = re.compile(r"<\|tool_call_start\|>(.*?)<\|tool_call_end\|>", re.S)
CALL = re.compile(r"^([A-Za-z_]\w*)\(", re.S)

MINIMAL_SYSTEM = (
    "You are a coding agent. Use one tool to answer. "
    "Do not describe the task, do not explain, do not plan."
)


def main():
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    token = os.environ.get("HF_TOKEN")
    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=token)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    model = AutoModelForCausalLM.from_pretrained(MODEL, token=token, dtype=dtype)
    model.eval()
    model.to("cuda" if torch.cuda.is_available() else "cpu")

    with open(CASES, encoding="utf-8") as handle:
        payload = json.load(handle)
    cases = [case for case in payload["cases"] if case["suite"] == "tool_calling"][:LIMIT]

    def run(messages, tools):
        prompt = tokenizer.apply_chat_template(
            messages, tools=tools or None, tokenize=False, add_generation_prompt=True
        )
        inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
        started = time.time()
        with torch.no_grad():
            generated = model.generate(
                **inputs,
                max_new_tokens=192,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        text = tokenizer.decode(generated[0][inputs["input_ids"].shape[1] :], skip_special_tokens=False)
        blocks = BLOCK.findall(text)
        names = [
            match.group(1)
            for block in blocks
            for part in block.strip().strip("[]").split(",")
            for match in [CALL.match(part.strip())]
            if match
        ]
        return {
            "prompt_tokens": int(inputs["input_ids"].shape[1]),
            "output_tokens": int(generated.shape[1] - inputs["input_ids"].shape[1]),
            "seconds": round(time.time() - started, 3),
            "call_blocks": len(blocks),
            "names": names,
            "text": text[:400],
        }

    rows = []
    for case in cases:
        system = case["messages"][0]
        rest = case["messages"][1:]
        expected = case.get("expect", {}).get("tool")
        tools = case.get("tools") or []
        trimmed = [tool for tool in tools if tool["name"] == expected] or tools[:1]
        with_directive = [
            *rest[:-1],
            {**rest[-1], "content": rest[-1]["content"] + "\n\nUse a tool call now. Do not describe the task."},
        ]

        conditions = {
            "as_is": (case["messages"], tools),
            "imperative": (case["messages"][:1] + with_directive, tools),
            "trimmed_tools": (case["messages"], trimmed),
            "minimal_sys": ([{"role": "system", "content": MINIMAL_SYSTEM}, *rest], tools),
            "no_system": (rest, tools),
        }

        measured = {}
        for name, (messages, condition_tools) in conditions.items():
            measured[name] = run(messages, condition_tools)

        rows.append(
            {
                "id": case["id"],
                "expected_tool": expected,
                "tools_available": len(tools),
                "system_chars": len(system.get("content") or ""),
                "system_excerpt": (system.get("content") or "")[:200],
                "conditions": measured,
            }
        )
        print(
            case["id"],
            {name: value["call_blocks"] for name, value in measured.items()},
            flush=True,
        )

    summary = {
        name: {
            "cases_with_a_call": sum(1 for row in rows if row["conditions"][name]["call_blocks"] > 0),
            "correct_tool_cases": sum(
                1
                for row in rows
                if row["expected_tool"] and row["expected_tool"] in row["conditions"][name]["names"]
            ),
            "average_prompt_tokens": round(
                sum(row["conditions"][name]["prompt_tokens"] for row in rows) / max(1, len(rows))
            ),
        }
        for name in rows[0]["conditions"]
    }

    report = {
        "status": "measured",
        "model": MODEL,
        "cases": len(rows),
        "conditions_per_case": 5,
        "decoding": "greedy, max_new_tokens=192 (identical to the frozen baseline)",
        "summary": summary,
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps({key: report[key] for key in ("status", "model", "cases", "summary")}))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
