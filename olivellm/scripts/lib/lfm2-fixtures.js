/**
 * Chat-template parity fixtures. Each case exercises one shape the renderer must reproduce byte for byte against the
 * real `tokenizer.apply_chat_template(..., tokenize=False)` of LiquidAI/LFM2.5-350M.
 *
 * `messages` uses the renderer's shape (`toolCalls: [{ id, name, arguments }]`); the Colab script converts it to the
 * Hugging Face shape (`tool_calls: [{ type: "function", function: { name, arguments } }]`).
 */

const tools = [
  {
    name: "read_file",
    description: "Read a text file inside the project. Optional 1-based start and end line numbers.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", minLength: 1 }, start: { type: "integer", minimum: 0 }, end: { type: "integer", minimum: 0 } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Create or replace a file with the given content.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", minLength: 1 }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "run_tests",
    description: "Run the project test script, or a given test command.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", minLength: 1 }, timeoutMs: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
  },
]

const system = {
  role: "system",
  content:
    "You are Olive, a local coding agent. Work in small steps and use tools.\nRules:\n- Inspect before editing.\n- Never claim a tool succeeded unless its result says ok.",
}

const longContent = `const router = require("express").Router()\n${Array.from({ length: 24 }, (_, index) => `router.get("/items/${index}", (req, res) => res.json({ index: ${index} }))`).join("\n")}\n`

export const FIXTURES = [
  {
    id: "english-plain",
    messages: [system, { role: "user", content: "Add a health endpoint to the task API." }, { role: "assistant", content: "I will read the server entry file first." }],
    tools,
  },
  {
    id: "persian-conversation",
    messages: [
      system,
      { role: "user", content: "یک صفحه ورود با React بساز که اطلاعات کاربر را در SQLite ذخیره کند." },
      { role: "assistant", content: "ابتدا ساختار پروژه را بررسی می‌کنم و سپس فایل ورود را می‌سازم." },
    ],
    tools,
  },
  {
    id: "mixed-persian-english",
    messages: [
      system,
      { role: "user", content: "این خطای `Cannot find module 'express'` را در server.js رفع کن." },
      { role: "assistant", content: "The dependency is missing: I will run install_dependencies, then run_tests again." },
    ],
    tools,
  },
  {
    id: "system-only",
    messages: [system],
    tools,
  },
  {
    id: "user-only-no-tools",
    messages: [{ role: "user", content: "Which file starts the server?" }],
    tools: [],
  },
  {
    id: "assistant-no-tools",
    messages: [system, { role: "user", content: "What is the entry point?" }, { role: "assistant", content: "The entry point is src/server.js." }],
    tools: [],
  },
  {
    id: "single-tool-call",
    messages: [
      system,
      { role: "user", content: "Read the first 40 lines of src/server.js" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "src/server.js", start: 1, end: 40 } }],
      },
    ],
    tools,
  },
  {
    id: "multiple-tool-calls",
    messages: [
      system,
      { role: "user", content: "Read the server and the router in parallel." },
      {
        role: "assistant",
        content: "Reading both files.",
        toolCalls: [
          { id: "call_1", name: "read_file", arguments: { path: "src/server.js" } },
          { id: "call_2", name: "read_file", arguments: { path: "src/routes/tasks.js", start: 2 } },
        ],
      },
    ],
    tools,
  },
  {
    id: "tool-result",
    messages: [
      system,
      { role: "user", content: "Read src/server.js" },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "read_file", arguments: { path: "src/server.js" } }] },
      { role: "tool", content: "const express = require(\"express\")\napp.listen(3000)", toolCallId: "call_1" },
      { role: "assistant", content: "The server listens on port 3000." },
    ],
    tools,
  },
  {
    id: "escaped-quotes",
    messages: [
      system,
      {
        role: "user",
        content: "Fix the string with 'single' and \"double\" quotes.",
      },
      {
        role: "assistant",
        content: "Editing the label.",
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: { path: "src/labels.js", content: "module.exports = { label: \"it's a \\\"quote\\\" and a backslash \\\\ end\" }\n" },
          },
        ],
      },
    ],
    tools,
  },
  {
    id: "newlines-and-tabs",
    messages: [
      system,
      { role: "user", content: "Write the multi-line config." },
      {
        role: "assistant",
        content: "Line one\nLine two\n\tIndented line",
        toolCalls: [{ id: "call_1", name: "write_file", arguments: { path: "config.txt", content: "a\r\nb\n\tc" } }],
      },
    ],
    tools,
  },
  {
    id: "unicode-content",
    messages: [
      system,
      { role: "user", content: "سلام 👋 این پیام شامل ایموجی و نویسه‌های یونیکد است: café, naïve, 日本語." },
      { role: "assistant", content: "دریافت شد ✅ — متن را با همان نویسه‌ها ذخیره می‌کنم." },
    ],
    tools,
  },
  {
    id: "empty-arguments",
    messages: [
      system,
      { role: "user", content: "Show the project tree." },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "write_file", arguments: {} }] },
    ],
    tools,
  },
  {
    id: "nested-json-arguments",
    messages: [
      system,
      { role: "user", content: "Write the settings object." },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_1",
            name: "write_file",
            arguments: {
              path: "settings.json",
              content: { theme: "dark", nested: { retries: 3, flags: [true, false, null] } },
            },
          },
        ],
      },
    ],
    tools,
  },
  {
    id: "numeric-and-boolean-arguments",
    messages: [
      system,
      { role: "user", content: "Run the tests with a longer timeout." },
      { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "run_tests", arguments: { command: "node --test test/", timeoutMs: 120000 } }] },
    ],
    tools,
  },
  {
    id: "long-tool-arguments",
    messages: [
      system,
      { role: "user", content: "Create the router file." },
      { role: "assistant", content: "Writing the router.", toolCalls: [{ id: "call_1", name: "write_file", arguments: { path: "src/routes/items.js", content: longContent } }] },
    ],
    tools,
  },
  {
    id: "generation-prompt",
    messages: [system, { role: "user", content: "List the project structure." }],
    tools,
    addGenerationPrompt: true,
  },
]
