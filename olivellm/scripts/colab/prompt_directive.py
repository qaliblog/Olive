"""Tests whether an imperative directive in the step message makes the model call a tool.

The frozen evaluation cases send the task-state block as the whole user turn. Nothing in that message asks the model to
do anything, so it treats the block as a document and answers with a status summary. This keeps the same cases and the
same decoding and appends one directive line, to find the smallest change that produces a call.

    colab-env.sh exec -s olive-lfm-gpu -f olivellm/scripts/colab/prompt_directive.py --timeout 1500
"""

import json
import os
import re
import time

MODEL = "LiquidAI/LFM2.5-350M"
CASES = os.environ.get("OLIVE_CASES", "/content/cases.json")
OUT = os.environ.get("OLIVE_OUT", "/content/olive-directive.json")
LIMIT = int(os.environ.get("OLIVE_LIMIT", "8"))
BLOCK = re.compile(r"<\|tool_call_start\|>(.*?)<\|tool_call_end\|>", re.S)
CALL = re.compile(r"(?:^|\[|,)\s*([A-Za-z_]\w*)\(", re.S)
OBJECTIVE = re.compile(r"^Objective:\s*(.+)$", re.M)

DIRECTIVES = {
    "as_is": lambda objective, step: step,
    "next_action": lambda objective, step: step
    + "\n\nDecide the single next action for this objective and call the tool that performs it now.",
    "call_it": lambda objective, step: step + "\n\nCall one tool now. Reply with the tool call only.",
    "objective_first": lambda objective, step: f"Objective: {objective}\n\nWhich single tool should you call next? Call it now.\n\n{step}",
    "probe_shape": lambda objective, step: f"What is the next step for this task? Use a tool to carry it out.\n\n{step}",
}


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
        names = []
        for block in blocks:
            body = block.strip()
            if body.startswith("["):
                body = body[1:].rstrip("]")
            names.extend(CALL.findall(body))
        return {
            "output_tokens": int(generated.shape[1] - inputs["input_ids"].shape[1]),
            "seconds": round(time.time() - started, 3),
            "call_blocks": len(blocks),
            "names": names,
            "text": text[:300],
        }

    rows = []
    for case in cases:
        system, rest = case["messages"][0], case["messages"][1:]
        step = rest[-1]["content"]
        found = OBJECTIVE.search(step)
        objective = found.group(1).strip() if found else case["id"]
        expected = case.get("expect", {}).get("tool")

        measured = {}
        for name, build in DIRECTIVES.items():
            messages = [system, *rest[:-1], {"role": "user", "content": build(objective, step)}]
            measured[name] = run(messages, case.get("tools") or [])
        rows.append(
            {
                "id": case["id"],
                "expected_tool": expected,
                "objective": objective,
                "conditions": measured,
            }
        )
        print(case["id"], {name: value["names"] for name, value in measured.items()}, flush=True)

    summary = {
        name: {
            "cases_with_a_call": sum(1 for row in rows if row["conditions"][name]["call_blocks"] > 0),
            "correct_tool_cases": sum(
                1 for row in rows if row["expected_tool"] and row["expected_tool"] in row["conditions"][name]["names"]
            ),
            "unknown_tool_calls": sum(
                1
                for row in rows
                for name2 in row["conditions"][name]["names"]
                if name2
                not in {
                    "read_file",
                    "write_file",
                    "edit_file",
                    "list_directory",
                    "search_code",
                    "find_symbols",
                    "run_shell",
                    "run_tests",
                    "install_dependencies",
                    "inspect_diagnostics",
                    "project_structure",
                }
            ),
        }
        for name in DIRECTIVES
    }

    report = {
        "status": "measured",
        "model": MODEL,
        "cases": len(rows),
        "decoding": "greedy, max_new_tokens=192",
        "summary": summary,
        "rows": rows,
    }
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
    print("OLIVE_JSON_BEGIN")
    print(json.dumps({"status": report["status"], "model": MODEL, "cases": len(rows), "summary": summary}))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
