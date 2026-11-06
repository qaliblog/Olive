import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveAgent } from "../src/olive/agent.js"
import { OliveProvider } from "../src/olive/provider.js"
import { OliveTaskState } from "../src/olive/task-state.js"

const encoder = new TextEncoder()

function stream(chunks: readonly string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

function toolCall(name: string, args: Record<string, unknown>) {
  return toolCalls([{ name, args }])
}

function toolCalls(calls: readonly { name: string; args: Record<string, unknown> }[]) {
  return stream([
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: `call_${index + 1}`,
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          },
        },
      ],
    })}\n\n`,
    "data: [DONE]\n\n",
  ])
}

function rawToolCall(name: string, argumentsText: string) {
  return stream([
    `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name, arguments: argumentsText } }] } }],
    })}\n\n`,
    "data: [DONE]\n\n",
  ])
}

function answer(text: string) {
  return stream([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, "data: [DONE]\n\n"])
}

function registry(baseURL: string): OliveProvider.Registry {
  const provider = OliveProvider.resolveProvider(
    {
      id: "local",
      type: "openai-compatible",
      baseURL,
      models: [{ id: "olive", context: 4096, maxOutput: 512, tools: true }],
    },
    {},
  )
  return { providers: [provider], default: { provider: "local", model: "olive" }, sources: [] }
}

function mock(responses: readonly (() => Response)[]) {
  const requests: Record<string, unknown>[] = []
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      requests.push((await request.json()) as Record<string, unknown>)
      return responses[Math.min(requests.length - 1, responses.length - 1)]!()
    },
  })
  return { server, requests, baseURL: `http://127.0.0.1:${server.port}/v1` }
}

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "olive-agent-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe("olive agent", () => {
  test("writes files incrementally and persists the task state after each operation", async () => {
    await withDirectory(async (directory) => {
      const objective = "create hello.txt"
      // A file change only counts as complete once a test run really succeeded after it, so the scripted model
      // writes, runs the tests, and only then stops.
      const fixture = mock([
        () => toolCall("write_file", { path: "hello.txt", content: "hi" }),
        () => toolCall("run_tests", { command: "true" }),
        () => answer("created hello.txt"),
      ])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(true)
        expect(outcome.steps).toBe(3)
        expect(outcome.failures).toEqual([])
        expect(await readFile(path.join(directory, "hello.txt"), "utf8")).toBe("hi")
        expect(outcome.task.files).toContain("hello.txt")
        expect((await OliveTaskState.read(OliveAgent.stateFile(directory)))?.completed).toContain("write initial files")
        const second = fixture.requests[1] as { messages: { content: string }[] }
        expect(second.messages.at(-1)?.content).toContain("hello.txt")
        expect(second.messages.at(-1)?.content).toContain("write_file ok")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("continues a saved task after a restart", async () => {
    await withDirectory(async (directory) => {
      const objective = "create hello.txt"
      const file = OliveAgent.stateFile(directory)
      const first = mock([
        () => toolCall("write_file", { path: "hello.txt", content: "hi" }),
        () => toolCall("run_tests", { command: "true" }),
        () => answer("created"),
      ])
      try {
        await OliveAgent.run({
          registry: registry(first.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(file, objective),
        })
      } finally {
        first.server.stop(true)
      }
      const second = mock([
        () => toolCall("edit_file", { path: "hello.txt", old: "hi", new: "bye" }),
        () => toolCall("run_tests", { command: "true" }),
        () => answer("edited"),
      ])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(second.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(file, objective),
        })
        expect(await readFile(path.join(directory, "hello.txt"), "utf8")).toBe("bye")
        expect(outcome.completed).toBe(true)
        expect(outcome.task.files).toContain("hello.txt")
      } finally {
        second.server.stop(true)
      }
    })
  })

  test("does not report completion when a change was never tested", async () => {
    await withDirectory(async (directory) => {
      const objective = "write the config file"
      const fixture = mock([
        () => toolCall("write_file", { path: "config.json", content: "{}\n" }),
        () => answer("Wrote config.json and verified it works."),
      ])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.error).toContain("no test run succeeded")
        expect(outcome.task.next).toBe("verify the result")
        expect(await readFile(path.join(directory, "config.json"), "utf8")).toBe("{}\n")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("reports a failed tool instead of pretending the operation succeeded", async () => {
    await withDirectory(async (directory) => {
      const objective = "read the missing file"
      const fixture = mock([() => toolCall("read_file", { path: "missing.ts" }), () => answer("everything worked")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.failures).toHaveLength(1)
        expect(outcome.failures[0]?.error.code).toBe("not-found")
        expect(outcome.task.errors.join(" ")).toContain("not-found")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("returns each executed call to the endpoint as a paired tool message", async () => {
    await withDirectory(async (directory) => {
      const objective = "create hello.txt"
      const fixture = mock([() => toolCall("write_file", { path: "hello.txt", content: "hi" }), () => answer("created")])
      try {
        await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        const second = fixture.requests[1] as {
          messages: { role: string; content: string; tool_calls?: { id: string }[]; tool_call_id?: string }[]
        }
        const assistant = second.messages.find((message) => message.tool_calls?.length)
        const results = second.messages.filter((message) => message.role === "tool")
        expect(assistant?.tool_calls?.map((call) => call.id)).toEqual(["call_1"])
        expect(results.map((message) => message.tool_call_id)).toEqual(["call_1"])
        expect(results[0]?.content).toContain("write_file ok")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("runs at most two calls per step and never records a call it skipped", async () => {
    await withDirectory(async (directory) => {
      const objective = "write three files"
      const fixture = mock([
        () =>
          toolCalls([
            { name: "write_file", args: { path: "a.txt", content: "a" } },
            { name: "write_file", args: { path: "b.txt", content: "b" } },
            { name: "write_file", args: { path: "c.txt", content: "c" } },
          ]),
        () => answer("wrote two files"),
      ])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(await readFile(path.join(directory, "a.txt"), "utf8")).toBe("a")
        expect(await readFile(path.join(directory, "b.txt"), "utf8")).toBe("b")
        expect(await readFile(path.join(directory, "c.txt"), "utf8").catch(() => undefined)).toBeUndefined()
        expect(outcome.task.files).toEqual(["a.txt", "b.txt"])
        const second = fixture.requests[1] as { messages: { role: string; tool_calls?: unknown[] }[] }
        expect(second.messages.find((message) => message.tool_calls?.length)?.tool_calls).toHaveLength(2)
        expect(second.messages.filter((message) => message.role === "tool")).toHaveLength(2)
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("does not report completion when the model never performed an operation", async () => {
    await withDirectory(async (directory) => {
      const objective = "build the login page"
      const fixture = mock([() => answer("done, everything works")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.failures).toEqual([])
        expect(outcome.error).toContain("any tool operation")
        expect(outcome.task.completed).toEqual([])
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("does not mark verification complete when only diagnostics ran", async () => {
    await withDirectory(async (directory) => {
      const objective = "type-check the project"
      const fixture = mock([() => toolCall("inspect_diagnostics", { command: "true" }), () => answer("types are fine")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.task.completed).toContain("run diagnostics")
        expect(outcome.task.completed).not.toContain("verify the result")
        expect(outcome.task.verification).toEqual(["inspect_diagnostics passed"])
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("does not mark the diagnostics step complete when only tests ran", async () => {
    await withDirectory(async (directory) => {
      const objective = "run the test suite"
      const fixture = mock([() => toolCall("run_tests", { command: "true" }), () => answer("tests pass")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.task.completed).toContain("verify the result")
        expect(outcome.task.completed).not.toContain("run diagnostics")
        expect(outcome.task.verification).toEqual(["run_tests passed"])
        expect(outcome.completed).toBe(true)
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("reports malformed tool arguments without executing the tool", async () => {
    await withDirectory(async (directory) => {
      const objective = "create hello.txt"
      const fixture = mock([() => rawToolCall("write_file", '{"path": "hello.txt"'), () => answer("created")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(await readFile(path.join(directory, "hello.txt"), "utf8").catch(() => undefined)).toBeUndefined()
        expect(outcome.failures).toHaveLength(1)
        expect(outcome.failures[0]?.error.code).toBe("invalid-arguments")
        expect(outcome.failures[0]?.error.message).toContain("not valid JSON")
        expect(outcome.completed).toBe(false)
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("refuses to run without a configured provider", async () => {
    await withDirectory(async (directory) => {
      expect(
        OliveAgent.run({
          registry: { providers: [], sources: [] },
          directory,
          objective: "anything",
          state: OliveTaskState.store(OliveAgent.stateFile(directory), "anything"),
        }),
      ).rejects.toThrow("no provider is configured")
    })
  })

  test("records a declared block instead of reporting completion", async () => {
    await withDirectory(async (directory) => {
      const objective = "publish the package"
      const fixture = mock([() => answer("BLOCKED: the registry rejects the token")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.error).toContain("registry rejects the token")
        expect(outcome.task.errors.join(" ")).toContain("registry rejects the token")
        expect(outcome.task.next).toBe("recover from the blocked operation")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("records a declared question and refuses to invent progress", async () => {
    await withDirectory(async (directory) => {
      const objective = "deploy to the production host"
      const fixture = mock([() => answer("QUESTION: which host should I deploy to?")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.error).toContain("needs clarification")
        expect(outcome.task.next).toBe("ask the user for the missing information")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("does not accept a DONE sentence as completion evidence", async () => {
    await withDirectory(async (directory) => {
      const objective = "write the config file"
      const fixture = mock([() => answer("DONE")])
      try {
        const outcome = await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        expect(outcome.completed).toBe(false)
        expect(outcome.error).toContain("any tool operation")
      } finally {
        fixture.server.stop(true)
      }
    })
  })

  test("sends the operative instruction on every model request", async () => {
    await withDirectory(async (directory) => {
      const objective = "read the package manifest"
      const fixture = mock([() => toolCall("read_file", { path: "package.json" }), () => answer("read it")])
      try {
        await writeFile(path.join(directory, "package.json"), "{}\n", "utf8")
        await OliveAgent.run({
          registry: registry(fixture.baseURL),
          directory,
          objective,
          state: OliveTaskState.store(OliveAgent.stateFile(directory), objective),
        })
        const first = fixture.requests[0] as { messages: { role: string; content: string }[] }
        expect(first.messages.at(-1)?.content).toContain("Call one tool now")
      } finally {
        fixture.server.stop(true)
      }
    })
  })
})
