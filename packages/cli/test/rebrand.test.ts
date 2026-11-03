import { describe, expect, test } from "bun:test"
import path from "node:path"

const cli = path.resolve(import.meta.dir, "..")
const root = path.resolve(cli, "../..")

// Names that belong to third-party packages and to the published pty helper. Their spellings
// come from the registry, so they keep the upstream name even after the rebrand.
const upstream = "open" + "code"
const thirdParty = [
  `@${upstream}/pty`,
  `${upstream}-pty`,
  `vite-plugin-${upstream}`,
  `@${upstream}-ai/client`,
  `@${upstream}-ai/protocol`,
  `@${upstream}-ai/schema`,
]

const ignored = [
  ".git",
  "node_modules",
  "dist",
  ".wrangler",
  ".turbo",
  "patches",
  "LICENSE",
  path.join("packages", "process-daemon", "npm"),
]

const skipped = (relative: string) =>
  ignored.some((part) => relative === part || relative.startsWith(part + path.sep) || relative.split(path.sep).includes(part))

async function textFiles(directory: string) {
  const files: string[] = []
  for await (const file of new Bun.Glob("**/*").scan({ cwd: directory, dot: true, onlyFiles: true })) {
    if (skipped(file)) continue
    files.push(path.join(directory, file))
  }
  return files
}

async function text(file: string) {
  const bytes = await Bun.file(file).bytes()
  if (bytes.includes(0)) return
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return
  }
}

const run = async (args: string[]) => {
  const child = Bun.spawn([process.execPath, path.join(cli, "src/index.ts"), ...args], {
    cwd: cli,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  return { stdout, stderr, code }
}

describe("rebrand", () => {
  test("the command line interface is installed as olive", async () => {
    const pkg = await Bun.file(path.join(cli, "package.json")).json()
    expect(pkg.name).toBe("@olive/cli")
    expect(pkg.bin).toEqual({ olive: "./bin/olive.cjs", olive2: "./bin/olive2.cjs" })
    expect(await Bun.file(path.join(cli, "bin/olive.cjs")).exists()).toBe(true)
  })

  test("no upstream branding is left in sources, docs or manifests", async () => {
    const branded: string[] = []
    for (const file of await textFiles(root)) {
      const content = await text(file)
      if (!content) continue
      const stripped = thirdParty.reduce((value, token) => value.split(token).join(""), content)
      if (new RegExp(upstream, "i").test(stripped)) branded.push(path.relative(root, file))
    }
    expect(branded).toEqual([])
  })

  test("the interface reports itself as olive and offers no upgrade command", async () => {
    const version = await run(["--version"])
    expect(version.stdout.trim()).toMatch(/^olive v/)

    const help = await run(["--help"])
    expect(help.stdout).toContain("Olive command line interface")
    expect(help.stdout).not.toMatch(/upgrade/)
  })

  test("nothing checks for, notifies about, or installs updates", async () => {
    expect(await Bun.file(path.join(root, "services/update")).exists()).toBe(false)

    for (const manifest of ["packages/cli"]) {
      const pkg = await Bun.file(path.join(root, manifest, "package.json")).json()
      const dependencies = Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.optionalDependencies,
      })
      expect(dependencies).not.toContain("electron-updater")
    }

    const checks = await Promise.all(
      ["packages/cli/src", "packages/tui/src"].map(async (directory) =>
        Promise.all(
          (await textFiles(path.join(root, directory))).map(async (file) => ({
            file: path.relative(root, file),
            content: (await text(file)) ?? "",
          })),
        ),
      ),
    ).then((groups) => groups.flat())
    const offenders = checks
      .filter((entry) => /electron-updater|update\/api|releases\/latest/.test(entry.content))
      .map((entry) => entry.file)
    expect(offenders).toEqual([])
  })
})
