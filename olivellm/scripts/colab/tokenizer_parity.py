"""Renders the parity fixtures with the real LFM2.5 tokenizer chat template.

Upload the fixtures with `colab upload`, then execute this file with `colab exec -f`. The path comes from
OLIVE_FIXTURES and defaults to /content/fixtures.json.

The token is read from HF_TOKEN in the kernel environment. It is never printed. Output is a JSON document between
markers so the caller can extract it from the session log.
"""

import json
import os
import sys

MODEL = "LiquidAI/LFM2.5-350M"


def to_hf(messages):
    """The renderer's `toolCalls` shape to the Hugging Face chat-template shape."""
    converted = []
    for message in messages:
        item = {"role": message["role"], "content": message.get("content", "")}
        if message.get("toolCalls"):
            item["tool_calls"] = [
                {"type": "function", "function": {"name": call["name"], "arguments": call["arguments"]}}
                for call in message["toolCalls"]
            ]
        converted.append(item)
    return converted


def main():
    path = os.environ.get("OLIVE_FIXTURES", "/content/fixtures.json")
    with open(path, encoding="utf-8") as handle:
        fixtures = json.load(handle)

    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(MODEL, token=os.environ.get("HF_TOKEN"))
    results = []
    for fixture in fixtures:
        messages = to_hf(fixture["messages"])
        entry = {"id": fixture["id"]}
        try:
            entry["output"] = tokenizer.apply_chat_template(
                messages,
                tools=fixture.get("tools") or None,
                tokenize=False,
                add_generation_prompt=bool(fixture.get("addGenerationPrompt")),
            )
        except Exception as error:  # noqa: BLE001 - the template's own message is the finding
            entry["error"] = f"{type(error).__name__}: {error}"
        results.append(entry)

    print("OLIVE_JSON_BEGIN")
    print(json.dumps({"model": MODEL, "tokenizer_class": type(tokenizer).__name__, "results": results}))
    print("OLIVE_JSON_END")


if __name__ == "__main__":
    main()
