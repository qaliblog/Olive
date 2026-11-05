import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OliveTools } from "../src/olive/tools.js"

/**
 * A lexical check accepts `link -> /etc` because the requested path looks internal. These tests prove the executor
 * follows the link and refuses anything whose real path leaves the workspace.
 */
async function withWorkspaces(run: (workspace: string, outside: string) => Promise<void>) {
  const base = await mkdtemp(path.join(os.tmpdir(), "olive-symlink-"))
  const workspace = path.join(base, "workspace")
  const outside = path.join(base, "outside")
  await mkdir(workspace, { recursive: true })
  await mkdir(outside, { recursive: true })
  await writeFile(path.join(outside, "secret.txt"), "secret\n", "utf8")
  await writeFile(path.join(workspace, "inside.txt"), "inside\n", "utf8")
  try {
    await run(workspace, outside)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

const context = (directory: string): OliveTools.Context => ({ directory })
const code = (result: OliveTools.Result) => (result.ok ? "ok" : result.error.code)

describe("olive tool symlink containment", () => {
  test("refuses to read an external file through a file symlink", async () => {
    await withWorkspaces(async (workspace, outside) => {
      await symlink(path.join(outside, "secret.txt"), path.join(workspace, "link.txt"))
      expect(code(await OliveTools.execute("read_file", { path: "link.txt" }, context(workspace)))).toBe("outside-workspace")
    })
  })

  test("refuses to write through an external directory symlink", async () => {
    await withWorkspaces(async (workspace, outside) => {
      await symlink(outside, path.join(workspace, "escape"))
      expect(code(await OliveTools.execute("write_file", { path: "escape/planted.txt", content: "x" }, context(workspace)))).toBe(
        "outside-workspace",
      )
      expect(await Bun.file(path.join(outside, "planted.txt")).exists()).toBe(false)
    })
  })

  test("refuses to edit an external file through a symlink", async () => {
    await withWorkspaces(async (workspace, outside) => {
      await symlink(path.join(outside, "secret.txt"), path.join(workspace, "link.txt"))
      expect(code(await OliveTools.execute("edit_file", { path: "link.txt", old: "secret", new: "leaked" }, context(workspace)))).toBe(
        "outside-workspace",
      )
      expect(await Bun.file(path.join(outside, "secret.txt")).text()).toBe("secret\n")
    })
  })

  test("refuses a nested symlink chain that ends outside", async () => {
    await withWorkspaces(async (workspace, outside) => {
      await symlink(outside, path.join(workspace, "outer"))
      await symlink(path.join(workspace, "outer"), path.join(workspace, "inner"))
      expect(code(await OliveTools.execute("list_directory", { path: "inner" }, context(workspace)))).toBe("outside-workspace")
      expect(code(await OliveTools.execute("read_file", { path: "inner/secret.txt" }, context(workspace)))).toBe("outside-workspace")
    })
  })

  test("allows a symlink that stays inside the workspace", async () => {
    await withWorkspaces(async (workspace) => {
      await symlink(path.join(workspace, "inside.txt"), path.join(workspace, "alias.txt"))
      const result = await OliveTools.execute("read_file", { path: "alias.txt" }, context(workspace))
      expect(result.ok).toBe(true)
      expect(result.ok ? result.output : "").toContain("inside")
    })
  })

  test("allows a new file whose parent directory does not exist yet", async () => {
    await withWorkspaces(async (workspace) => {
      expect(code(await OliveTools.execute("write_file", { path: "src/deep/new.ts", content: "export {}\n" }, context(workspace)))).toBe("ok")
      expect(await Bun.file(path.join(workspace, "src/deep/new.ts")).exists()).toBe(true)
    })
  })

  test("refuses a dangling symlink whose destination cannot be verified", async () => {
    await withWorkspaces(async (workspace) => {
      await symlink(path.join(workspace, "not-created-yet.txt"), path.join(workspace, "dangling.txt"))
      // The destination cannot be resolved, so the link could point anywhere: refuse it instead of guessing.
      expect(code(await OliveTools.execute("write_file", { path: "dangling.txt", content: "x" }, context(workspace)))).toBe(
        "outside-workspace",
      )
      expect(await Bun.file(path.join(workspace, "not-created-yet.txt")).exists()).toBe(false)
    })
  })

  test("refuses path traversal and absolute paths", async () => {
    await withWorkspaces(async (workspace) => {
      expect(code(await OliveTools.execute("read_file", { path: "../outside/secret.txt" }, context(workspace)))).toBe("outside-workspace")
      expect(code(await OliveTools.execute("read_file", { path: "/etc/passwd" }, context(workspace)))).toBe("outside-workspace")
      expect(code(await OliveTools.execute("project_structure", { path: ".." }, context(workspace)))).toBe("outside-workspace")
    })
  })
})
