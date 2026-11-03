import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveTools } from "../src/olive/tools.js"

async function withDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "olive-tools-"))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const context = (directory: string): OliveTools.Context => ({ directory })

function output(result: OliveTools.Result) {
  if (!result.ok) throw new Error(`${result.tool}: ${result.error.code}: ${result.error.message}`)
  return result.output
}

const code = (result: OliveTools.Result) => (result.ok ? "ok" : result.error.code)

describe("olive tools", () => {
  test("writes, reads, edits, searches, and indexes a file", async () => {
    await withDirectory(async (directory) => {
      expect(output(await OliveTools.execute("write_file", { path: "src/app.ts", content: "export function greet() {\n  return 'hi'\n}\n" }, context(directory)))).toContain("src/app.ts")
      expect(output(await OliveTools.execute("read_file", { path: "src/app.ts", start: 1, end: 1 }, context(directory)))).toContain("greet")
      expect(output(await OliveTools.execute("edit_file", { path: "src/app.ts", old: "'hi'", new: "'hello'" }, context(directory)))).toContain("edited")
      expect(await readFile(path.join(directory, "src/app.ts"), "utf8")).toContain("'hello'")
      expect(output(await OliveTools.execute("search_code", { query: "hello" }, context(directory)))).toContain("src/app.ts:2")
      expect(output(await OliveTools.execute("find_symbols", {}, context(directory)))).toContain("greet")
      expect(output(await OliveTools.execute("list_directory", { path: "src" }, context(directory)))).toContain("app.ts")
      expect(output(await OliveTools.execute("project_structure", { depth: 2 }, context(directory)))).toContain("src/")
    })
  })

  test("rejects malformed and unknown tool arguments", async () => {
    await withDirectory(async (directory) => {
      expect(code(await OliveTools.execute("read_file", { path: "a.ts", extra: true }, context(directory)))).toBe("invalid-arguments")
      expect(code(await OliveTools.execute("delete_everything", {}, context(directory)))).toBe("invalid-arguments")
      expect(code(await OliveTools.execute("edit_file", { path: "a.ts", old: "", new: "x" }, context(directory)))).toBe("invalid-arguments")
    })
  })

  test("refuses to touch paths outside the project", async () => {
    await withDirectory(async (directory) => {
      expect(code(await OliveTools.execute("write_file", { path: "../escape.ts", content: "x" }, context(directory)))).toBe("outside-workspace")
      expect(code(await OliveTools.execute("read_file", { path: "/etc/hosts" }, context(directory)))).toBe("outside-workspace")
    })
  })

  test("leaves the file untouched when an edit cannot be applied", async () => {
    await withDirectory(async (directory) => {
      await writeFile(path.join(directory, "a.ts"), "const a = 1\nconst a = 1\n")
      expect(code(await OliveTools.execute("edit_file", { path: "a.ts", old: "missing", new: "x" }, context(directory)))).toBe("no-match")
      expect(code(await OliveTools.execute("edit_file", { path: "a.ts", old: "const a = 1", new: "x" }, context(directory)))).toBe("ambiguous-match")
      expect(await readFile(path.join(directory, "a.ts"), "utf8")).toBe("const a = 1\nconst a = 1\n")
    })
  })

  test("runs shell commands and reports failures honestly", async () => {
    await withDirectory(async (directory) => {
      expect(output(await OliveTools.execute("run_shell", { command: "printf hello" }, context(directory)))).toContain("hello")
      expect(code(await OliveTools.execute("run_shell", { command: "exit 3" }, context(directory)))).toBe("command-failed")
      expect(code(await OliveTools.execute("run_shell", { command: "sleep 2", timeoutMs: 100 }, context(directory)))).toBe("timeout")
    })
  })

  test("detects the package manager and diagnostics scripts from the project", async () => {
    await withDirectory(async (directory) => {
      expect(code(await OliveTools.execute("install_dependencies", {}, context(directory)))).toBe("not-found")
      expect(code(await OliveTools.execute("inspect_diagnostics", {}, context(directory)))).toBe("not-found")
      await writeFile(path.join(directory, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }))
      await writeFile(path.join(directory, "bun.lock"), "")
      expect(output(await OliveTools.execute("install_dependencies", { command: "true" }, context(directory)))).toContain("exit code 0")
      expect(code(await OliveTools.execute("inspect_diagnostics", { command: "true" }, context(directory)))).toBe("ok")
    })
  })
})
