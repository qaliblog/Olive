import { EPOCH, makeExample, makeId, success, failure, rendered } from "./emit.js"
import { ERROR_FAMILIES } from "./errors.js"
import { PROJECTS, byId, workspaceOf } from "./projects.js"
import { SNIPPETS } from "./snippets.js"
import { WORKFLOW, advance, apply, create, progress } from "./state.js"

const call = (name, args, why) => ({ name, arguments: args, why })

function baseState(project, objective, patch = {}, seed = 0) {
  const seeded = apply(create(objective, EPOCH + seed), { project: project.name, plan: WORKFLOW, remaining: WORKFLOW }, EPOCH + seed)
  return Object.keys(patch).length === 0 ? seeded : advance(seeded, patch, EPOCH + seed)
}

function snippetOf(project, path, lines = 24) {
  const text = project.files[path]
  if (text === undefined) throw new Error(`${project.id}: ${path} is not in the corpus`)
  return { file: path, text: text.split("\n").slice(0, lines).join("\n"), kind: "file" }
}

function readResult(project, path, start, end) {
  const text = project.files[path] ?? project.files[path.replace(/^\//, "")]
  if (text === undefined) throw new Error(`${project.id}: cannot read ${path}`)
  const lines = text.split("\n")
  return success("read_file", lines.slice(Math.max(0, (start ?? 1) - 1), end ?? lines.length).join("\n"))
}

function bytes(text) {
  return Buffer.byteLength(text, "utf8")
}

/** Mirrors OliveTools.symbolsOf so find_symbols results are real index output, not invented names. */
function symbolsOf(text, file) {
  const extension = file.slice(file.lastIndexOf("."))
  const patterns = {
    ".ts": /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    ".tsx": /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    ".js": /^[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    ".py": /^[ \t]*(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/gm,
    ".css": /^[ \t]*([.#][A-Za-z_][\w-]*)[ \t]*\{/gm,
  }
  const pattern = patterns[extension]
  if (!pattern) return []
  return [...text.matchAll(pattern)].map((match) => ({
    name: match[1],
    line: text.slice(0, match.index).split("\n").length,
  }))
}

function directoryEntries(project, directory) {
  const prefix = directory === "." ? "" : `${directory.replace(/\/$/, "")}/`
  const names = new Set()
  for (const item of workspaceOf(project)) {
    if (!item.startsWith(prefix) || item === prefix) continue
    const rest = item.slice(prefix.length)
    const [head] = rest.split("/")
    if (head.length === 0) continue
    names.add(rest.includes("/") ? `${head}/` : head)
  }
  return [...names].toSorted((left, right) => left.localeCompare(right))
}

function tree(project, depth = 2) {
  const lines = []
  const walk = (directory, level) => {
    if (level > depth || lines.length >= 300) return
    const entries = directoryEntries(project, directory)
    const files = entries.filter((entry) => !entry.endsWith("/"))
    const directories = entries.filter((entry) => entry.endsWith("/"))
    for (const entry of [...directories, ...files]) {
      lines.push(`${"  ".repeat(level)}${entry}`)
      if (entry.endsWith("/") && level + 1 <= depth) walk(`${directory === "." ? "" : `${directory}/`}${entry.slice(0, -1)}`, level + 1)
    }
  }
  walk(".", 0)
  return lines.join("\n")
}

function searchLines(project, query, limit = 3) {
  const matches = []
  for (const [file, text] of Object.entries(project.files)) {
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.includes(query)) continue
      matches.push(`${file}:${index + 1}: ${line.trim().slice(0, 200)}`)
      if (matches.length >= limit) break
    }
    if (matches.length >= limit) break
  }
  if (matches.length === 0) throw new Error(`${project.id}: query ${query} does not appear in the corpus`)
  return matches.join("\n")
}

function projectById(id) {
  const project = byId[id]
  if (!project) throw new Error(`unknown project ${id}`)
  return project
}

/** First action for an objective: inspect the tree when the project is unknown, otherwise read the entry file. */
function firstInspection(project, objective) {
  const known = objective.toLowerCase().includes(project.name.toLowerCase()) || objective.includes(project.id)
  return known ? call("read_file", { path: entryFile(project) }, "read the entry file before changing anything") : call("project_structure", { depth: 2 }, "see what the project already contains")
}

function entryFile(project) {
  const preferred = ["src/server.js", "src/app.js", "App.tsx", "app.py", "index.html", "src/App.tsx", "src/main.ts"]
  return preferred.find((path) => project.files[path]) ?? Object.keys(project.files)[0]
}

function persianGoals() {
  return PROJECTS.flatMap((project) => (project.goals.fa ?? []).map((goal) => ({ project, goal, language: "fa" })))
}

function englishGoals() {
  return PROJECTS.flatMap((project) => (project.goals.en ?? []).map((goal) => ({ project, goal, language: "en" })))
}

/** 1. Intent: restate the objective in one sentence, then inspect. Never chat without acting. */
function intent(counters) {
  return [...englishGoals(), ...persianGoals()].map(({ project, goal, language }, index) => {
    const state = baseState(project, goal, {}, index)
    const inspection = firstInspection(project, goal)
    const n = (counters.intent_understanding += 1)
    return makeExample({
      id: makeId("intent_understanding", project.id, language, n),
      category: "intent_understanding",
      language,
      difficulty: "easy",
      objective: goal,
      project,
      state,
      plan: WORKFLOW.slice(0, 3),
      calls: [inspection],
      results: [inspection.name === "read_file" ? readResult(project, inspection.arguments.path) : success("project_structure", tree(project))],
      response: {
        text:
          language === "fa"
            ? `هدف: ${goal}. ابتدا ساختار پروژه را بررسی می‌کنم و بعد تغییر را انجام می‌دهم.`
            : `The task is to ${goal.replace(/^(build|add|make|create|fix|wire|connect|show|load|raise|verify|reject|compare|persist|validate|style)\b/i, (verb) => verb.toLowerCase())}. I will inspect the project before changing anything.`,
      },
      generator: "generators.intent",
      seed: index,
    })
  })
}

/** 2. Requirement extraction: name the concrete requirements, then read the file that decides them. */
function requirements(counters) {
  const specs = englishGoals()
    .filter(({ project }) => entryFile(project))
    .flatMap(({ project, goal, language }, index) => [
      { project, goal, language, need: "input validation", path: entryFile(project), index },
      { project, goal, language, need: "persistence", path: entryFile(project), index: index + 1000 },
    ])
  return specs.map(({ project, goal, need, path, index }) => {
    const n = (counters.requirement_extraction += 1)
    const objective = `requirements for ${need}: ${goal}`
    const state = baseState(project, objective, {}, index)
    const read = call("read_file", { path, start: 1, end: 40 }, `read ${path} to check whether ${need} already exists`)
    return makeExample({
      id: makeId("requirement_extraction", project.id, "en", n),
      category: "requirement_extraction",
      language: "en",
      difficulty: "medium",
      objective,
      project,
      state,
      plan: ["analyze requirements"],
      calls: [read],
      results: [readResult(project, path, 1, 40)],
      response: {
        text: `Requirements: (1) ${goal}; (2) ${need} at the boundary; (3) a test that fails without the change. I will read ${path} to see what already exists.`,
      },
      generator: "generators.requirements",
      seed: index,
    })
  })
}

/** 3. Planning: a short ordered plan, then the directory listing that confirms it. */
function planning(counters) {
  return englishGoals().map(({ project, goal }, index) => {
    const n = (counters.task_planning += 1)
    const state = baseState(project, goal, {}, index)
    const listing = call("list_directory", { path: "." }, "confirm the plan against the files that exist")
    const secondFile = Object.keys(project.files).find((file) => file !== entryFile(project)) ?? entryFile(project)
    return makeExample({
      id: makeId("task_planning", project.id, "en", n),
      category: "task_planning",
      language: "en",
      difficulty: "medium",
      objective: `plan the work for: ${goal}`,
      project,
      state,
      plan: WORKFLOW.slice(0, 5),
      calls: [listing],
      results: [success("list_directory", directoryEntries(project, ".").join("\n"))],
      response: {
        text: `Plan for "${goal}": read ${entryFile(project)}; make the change in ${entryFile(project)} and ${secondFile}; run diagnostics; then run the tests. I start from the listing of ${project.name}.`,
      },
      generator: "generators.planning",
      seed: index,
    })
  })
}

/** 4. Project structure: list real trees and directories. */
function structure(counters) {
  const rows = []
  for (const project of PROJECTS) {
    const n = (counters.project_structure += 1)
    const objective = `map the structure of ${project.name}`
    const state = baseState(project, objective, {}, n)
    rows.push(
      makeExample({
        id: makeId("project_structure", project.id, "en", n),
        category: "project_structure",
        language: "en",
        difficulty: "easy",
        objective,
        project,
        state,
        plan: ["analyze requirements"],
        calls: [call("project_structure", { depth: 2 }, "shallow tree is enough to choose the next file")],
        results: [success("project_structure", tree(project, 2))],
        response: { text: `The tree shows ${Object.keys(project.files).length} files; the entry point is ${entryFile(project)}.` },
        generator: "generators.structure",
        seed: n,
      }),
    )
  }
  for (const project of PROJECTS.slice(0, 5)) {
    const n = (counters.project_structure += 1)
    const directory = project.dirs[0]?.replace(/\/$/, "") ?? "."
    rows.push(
      makeExample({
        id: makeId("project_structure", `${project.id}_listing`, "en", n),
        category: "project_structure",
        language: "en",
        difficulty: "easy",
        objective: `list ${directory === "." ? "the project root" : directory} of ${project.name}`,
        project,
        state: baseState(project, `inspect ${project.name}`, {}, n),
        calls: [call("list_directory", { path: directory }, "list one directory instead of the whole tree")],
        results: [success("list_directory", directoryEntries(project, directory).join("\n"))],
        response: { text: `${directory} contains ${directoryEntries(project, directory).length} entries.` },
        generator: "generators.structure",
        seed: n,
      }),
    )
  }
  return rows
}

/** 5. File reading: whole file, ranges, config, tests, and the outside-workspace failure. */
function reading(counters) {
  const rows = []
  for (const project of PROJECTS) {
    const n = (counters.file_reading += 1)
    const path = entryFile(project)
    const lines = project.files[path].split("\n")
    rows.push(
      makeExample({
        id: makeId("file_reading", project.id, "en", n),
        category: "file_reading",
        language: "en",
        difficulty: "easy",
        objective: `read ${path} in ${project.name}`,
        project,
        state: baseState(project, `read ${path}`, {}, n),
        calls: [call("read_file", { path }, `read the entry file of ${project.name}`)],
        results: [success("read_file", project.files[path])],
        response: { text: `${path} is ${lines.length} lines; it starts at the import block and ends with ${lines.at(-2)}.` },
        generator: "generators.reading",
        seed: n,
      }),
    )
    if (lines.length > 8) {
      const m = (counters.file_reading += 1)
      rows.push(
        makeExample({
          id: makeId("file_reading", `${project.id}_range`, "en", m),
          category: "file_reading",
          language: "en",
          difficulty: "easy",
          objective: `read lines 1 to 6 of ${path} in ${project.name}`,
          project,
          state: baseState(project, `inspect the top of ${path}`, {}, m),
          calls: [call("read_file", { path, start: 1, end: 6 }, "only the header is needed for this question")],
          results: [success("read_file", lines.slice(0, 6).join("\n"))],
          response: { text: `Lines 1-6 show the imports and the first declaration in ${path}.` },
          generator: "generators.reading",
          seed: m,
        }),
      )
    }
  }
  const outside = projectById("node_api")
  const n = (counters.file_reading += 1)
  rows.push(
    makeExample({
      id: makeId("file_reading", "outside_workspace", "en", n),
      category: "file_reading",
      language: "en",
      difficulty: "medium",
      objective: "check the database settings that are outside the project",
      project: outside,
      state: baseState(outside, "check the database settings", {}, n),
      calls: [call("read_file", { path: "../secrets.env" }, "the model tries a path outside the project")],
      results: [failure("read_file", "outside-workspace", "../secrets.env is outside the project")],
      response: { text: "That path is outside the project. I will read src/db.js instead, which holds the database setup." },
      generator: "generators.reading",
      seed: n,
    }),
  )
  return rows
}

/** 6/7/8. Writing and editing: every snippet becomes a write after a read, or a new file. */
function codeWork(counters) {
  const rows = []
  for (const snippet of SNIPPETS) {
    const project = projectById(snippet.projectId)
    const exists = project.files[snippet.file] !== undefined
    const category = exists ? "file_editing" : "file_creation"
    const n = (counters[category] += 1)
    const priorResults = exists ? [readResult(project, snippet.file)] : []
    const language = "en"
    rows.push(
      makeExample({
        id: makeId(category, snippet.id, language, n),
        category,
        language,
        difficulty: snippet.code.split("\n").length > 20 ? "hard" : "medium",
        objective: exists ? snippet.goal.en : `create ${snippet.file}: ${snippet.goal.en}`,
        project,
        state: baseState(project, snippet.goal.en, {}, n),
        code: [snippetOf(project, exists ? snippet.file : entryFile(project))],
        priorResults,
        plan: ["write initial files", "implement remaining files"],
        calls: [
          call(
            "write_file",
            { path: snippet.file, content: snippet.code },
            exists ? `replace ${snippet.file} with the corrected version` : `create ${snippet.file} for this change`,
          ),
        ],
        results: [success("write_file", `wrote ${snippet.file} (${bytes(snippet.code)} bytes)`, { files: [snippet.file] })],
        response: {
          text: exists
            ? `I read ${snippet.file} and will replace it with this version.`
            : `${snippet.file} does not exist yet; creating it with the smallest complete implementation.`,
        },
        workspace: [...workspaceOf(project), snippet.file],
        generator: "generators.codeWork",
        seed: n,
      }),
    )
  }
  return rows
}

/** A second coding pass that answers "show me" requests with a fenced block instead of a tool call. */
function codeExplanation(counters) {
  return SNIPPETS.filter((snippet, index) => index % 3 === 0).map((snippet, index) => {
    const project = projectById(snippet.projectId)
    const n = (counters.code_generation += 1)
    return makeExample({
      id: makeId("code_generation", `${snippet.id}_answer`, "en", n),
      category: "code_generation",
      language: "en",
      difficulty: "medium",
      objective: `show the code for: ${snippet.goal.en}`,
      project,
      state: baseState(project, snippet.goal.en, {}, index),
      plan: [],
      calls: [],
      results: [],
      response: { text: `${snippet.intro}\n\n\`\`\`${snippet.fence}\n${snippet.code}\n\`\`\``, completion: "done" },
      generator: "generators.codeExplanation",
      seed: index,
    })
  })
}

/** 9. Dependency installation: detected managers, explicit commands, and the Python no-manager failure. */
function dependencies(counters) {
  const rows = []
  const cases = [
    { project: "node_api", args: { command: "npm install" }, output: "added 128 packages in 4s\n(exit code 0)" },
    { project: "crud_api", args: { command: "npm install" }, output: "added 94 packages in 3s\n(exit code 0)" },
    { project: "react_login", args: {}, output: "installed with bun\n 412 packages\n(exit code 0)" },
    { project: "react_dashboard", args: {}, output: "installed with bun\n 388 packages\n(exit code 0)" },
    { project: "capacitor_android", args: { command: "npm install" }, output: "added 51 packages in 2s\n(exit code 0)" },
    { project: "express_auth", args: { command: "npm install" }, output: "added 73 packages in 5s\n(exit code 0)" },
    { project: "tailwind_landing", args: { command: "npm install" }, output: "added 12 packages in 2s\n(exit code 0)" },
  ]
  for (const item of cases) {
    const project = projectById(item.project)
    const n = (counters.dependency_installation += 1)
    const state = baseState(project, `install dependencies for ${project.name}`, { completed: ["write initial files"] }, n)
    rows.push(
      makeExample({
        id: makeId("dependency_installation", project.id, "en", n),
        category: "dependency_installation",
        language: "en",
        difficulty: "easy",
        objective: `install the dependencies of ${project.name}`,
        project,
        state,
        calls: [call("install_dependencies", item.args, "install before running anything that imports a package")],
        results: [success("install_dependencies", item.output)],
        response: { text: "Dependencies are installed; the next step is diagnostics." },
        generator: "generators.dependencies",
        seed: n,
      }),
    )
  }
  const python = projectById("python_cli")
  const n = (counters.dependency_installation += 1)
  const state = baseState(python, "install dependencies for csvtool", {}, n)
  rows.push(
    makeExample({
      id: makeId("dependency_installation", "python_no_manager", "fa", n),
      category: "dependency_installation",
      language: "fa",
      difficulty: "medium",
      objective: "وابستگی‌های پروژه پایتون را نصب کن",
      project: python,
      state,
      calls: [call("install_dependencies", {}, "there is no package.json for this project")],
      results: [failure("install_dependencies", "not-found", "no package manager files were found")],
      response: {
        text: "این پروژه فایل مدیریت بسته ندارد و requirements.txt خالی است. باید دستور نصب را صریح بدهم یا از pip استفاده کنم.",
      },
      generator: "generators.dependencies",
      seed: n,
    }),
  )
  return rows
}

/** 10. Diagnostics: success, reported type error, and the missing-script failure. */
function diagnostics(counters) {
  const rows = []
  const okCases = [
    ["react_dashboard", { command: "npm run typecheck" }, "tsc --noEmit\n\nFound 0 errors.\n(exit code 0)"],
    ["react_login", { command: "npm run typecheck" }, "tsc --noEmit\n\nFound 0 errors.\n(exit code 0)"],
    ["node_api", { command: "node --check src/server.js" }, "(no output)\n(exit code 0)"],
    ["python_cli", { command: "python -m compileall -q ." }, "(no output)\n(exit code 0)"],
    ["express_auth", { command: "node --check src/server.js" }, "(no output)\n(exit code 0)"],
  ]
  for (const [projectId, args, output] of okCases) {
    const project = projectById(projectId)
    const n = (counters.diagnostics += 1)
    rows.push(
      makeExample({
        id: makeId("diagnostics", project.id, "en", n),
        category: "diagnostics",
        language: "en",
        difficulty: "easy",
        objective: `run diagnostics on ${project.name}`,
        project,
        state: baseState(project, `check ${project.name}`, { completed: ["write initial files", "implement remaining files"] }, n),
        calls: [call("inspect_diagnostics", args, "type check before claiming the code is correct")],
        results: [success("inspect_diagnostics", output)],
        response: { text: "Diagnostics pass; the next step is the test run." },
        generator: "generators.diagnostics",
        seed: n,
      }),
    )
  }
  const failing = projectById("react_dashboard")
  const n = (counters.diagnostics += 1)
  const failureResult = failure(
    "inspect_diagnostics",
    "command-failed",
    "npm run typecheck exited with code 2\nsrc/pages/Overview.tsx(1,25): error TS2307: Cannot find module \"./components/StatCard\" or its corresponding type declarations.",
  )
  const failedState = progress(baseState(failing, "check dashboard", { completed: ["write initial files"] }, n), failureResult)
  rows.push(
    makeExample({
      id: makeId("diagnostics", "type_error", "en", n),
      category: "diagnostics",
      language: "en",
      difficulty: "medium",
      objective: "run the type check and report what it finds",
      project: failing,
      state: failedState,
      priorResults: [failureResult],
      calls: [call("inspect_diagnostics", { command: "npm run typecheck" }, "verify whether the import error is the only one")],
      results: [failureResult],
      response: { text: "The type check reports TS2307 in Overview.tsx; the import path is wrong and needs one edit." },
      generator: "generators.diagnostics",
      seed: n,
    }),
  )
  const tailwind = projectById("tailwind_landing")
  const m = (counters.diagnostics += 1)
  rows.push(
    makeExample({
      id: makeId("diagnostics", "no_script", "en", m),
      category: "diagnostics",
      language: "en",
      difficulty: "medium",
      objective: "type check the landing page",
      project: tailwind,
      state: baseState(tailwind, "check the landing page", {}, m),
      calls: [call("inspect_diagnostics", {}, "the default script is expected to exist")],
      results: [failure("inspect_diagnostics", "not-found", "no typecheck or check script is defined; pass an explicit command")],
      response: { text: "There is no typecheck script. I will pass an explicit validator command instead of assuming one exists." },
      generator: "generators.diagnostics",
      seed: m,
    }),
  )
  return rows
}

/** 11. Test execution: passing suites, failing suites, wrong runner, and the verification conclusion. */
function tests(counters) {
  const rows = []
  const cases = [
    ["node_api", "npm test", "> task-api@0.1.0 test\n> node --test test/\n\nok 1 - lists tasks\n# pass 1\n# fail 0\n(exit code 0)"],
    ["crud_api", "node --test", "ok 1 - creates a note\nok 2 - lists notes\n# pass 2\n# fail 0\n(exit code 0)"],
    ["python_cli", "python -m pytest -q", "..\n2 passed in 0.18s\n(exit code 0)"],
    ["react_login", "npm run test", "vitest run\n\n✓ src/components/LoginForm.test.tsx (2)\n\nTest Files 1 passed\n(exit code 0)"],
    ["express_auth", "node --test", "ok 1 - registers a user\nok 2 - rejects a duplicate email\n# pass 2\n# fail 0\n(exit code 0)"],
  ]
  for (const [projectId, command, output] of cases) {
    const project = projectById(projectId)
    const n = (counters.test_execution += 1)
    rows.push(
      makeExample({
        id: makeId("test_execution", project.id, "en", n),
        category: "test_execution",
        language: "en",
        difficulty: "easy",
        objective: `run the tests for ${project.name}`,
        project,
        state: baseState(project, `test ${project.name}`, { completed: ["write initial files", "implement remaining files", "run diagnostics"] }, n),
        calls: [call("run_tests", { command }, "run the suite with the command this project defines")],
        results: [success("run_tests", output)],
        response: { text: "All tests pass. Verification is recorded and the task can be reported as complete." },
        generator: "generators.tests",
        seed: n,
      }),
    )
  }
  const failing = projectById("python_cli")
  const n = (counters.test_execution += 1)
  const failed = failure("run_tests", "command-failed", "python -m pytest -q exited with code 1\nFAILED tests/test_app.py::test_summarise - KeyError: 'rows'\n1 failed in 0.21s")
  const failedState = progress(baseState(failing, "test csvtool", { completed: ["write initial files", "implement remaining files", "run diagnostics"] }, n), failed)
  rows.push(
    makeExample({
      id: makeId("test_execution", "failing_suite", "en", n),
      category: "test_execution",
      language: "en",
      difficulty: "medium",
      objective: "run the tests and decide what to fix",
      project: failing,
      state: failedState,
      priorResults: [failed],
      calls: [call("read_file", { path: "app.py", start: 1, end: 20 }, "read the function the failing test exercises")],
      results: [readResult(failing, "app.py")],
      response: { text: "One test fails with KeyError 'rows'; app.py returns a different key set. Fix the return value, then rerun pytest." },
      generator: "generators.tests",
      seed: n,
    }),
  )
  const python = projectById("python_cli")
  const m = (counters.test_execution += 1)
  rows.push(
    makeExample({
      id: makeId("test_execution", "wrong_runner", "en", m),
      category: "test_execution",
      language: "en",
      difficulty: "medium",
      objective: "run the test suite of the Python project",
      project: python,
      state: baseState(python, "run the python tests", {}, m),
      calls: [call("run_tests", {}, "no command was given, so the default runner is used")],
      results: [failure("run_tests", "command-failed", 'bun test exited with code 1\nbun test v1.4.4\nerror: Script not found "test"')],
      response: { text: "The default runner is Bun and this is a Python project. Pass python -m pytest -q explicitly." },
      generator: "generators.tests",
      seed: m,
    }),
  )
  return rows
}

/** 12. Error recovery: every failure family, in English and with a Persian explanation. */
function recovery(counters) {
  const rows = []
  for (const family of ERROR_FAMILIES) {
    const project = projectById(family.projectId)
    const failureResult = failure(family.tool, family.code, family.message)
    const analysed = progress(baseState(project, family.en, { completed: ["write initial files"] }, counters.error_recovery), failureResult)
    const en = (counters.error_recovery += 1)
    rows.push(
      makeExample({
        id: makeId("error_recovery", family.id, "en", en),
        category: "error_recovery",
        language: "en",
        difficulty: "medium",
        objective: `${family.id.replaceAll("_", " ")}: fix the failing ${family.tool} result`,
        project,
        state: analysed,
        priorResults: [failureResult],
        plan: ["fix errors"],
        calls: family.fix.map((item) => call(item.name, item.arguments, item.why)),
        results: family.fix.map((item) => fixResult(project, item)),
        response: { text: family.en },
        workspace: [...workspaceOf(project), ...family.fix.flatMap((item) => (item.arguments.path ? [item.arguments.path] : []))],
        generator: "generators.recovery",
        seed: en,
      }),
    )
    if (family.fa) {
      const fa = (counters.error_recovery += 1)
      const objective = `${family.id.replaceAll("_", " ")}: خطای ${family.tool} را برطرف کن`
      rows.push(
        makeExample({
          id: makeId("error_recovery", family.id, "fa", fa),
          category: "error_recovery",
          language: "fa",
          difficulty: "medium",
          objective,
          project,
          state: progress(baseState(project, objective, { completed: ["write initial files"] }, fa), failureResult),
          priorResults: [failureResult],
          plan: ["fix errors"],
          calls: family.fix.map((item) => call(item.name, item.arguments, item.why)),
          results: family.fix.map((item) => fixResult(project, item)),
          response: { text: family.fa },
          workspace: [...workspaceOf(project), ...family.fix.flatMap((item) => (item.arguments.path ? [item.arguments.path] : []))],
          generator: "generators.recovery",
          seed: fa,
        }),
      )
    }
  }
  return rows
}

/** The result a minimal fix would produce, derived from the tool's real success wording. */
function fixResult(project, item) {
  if (item.name === "read_file")
    return readResult(project, item.arguments.path, item.arguments.start, item.arguments.end)
  if (item.name === "edit_file") return success("edit_file", `edited ${item.arguments.path}`, { files: [item.arguments.path] })
  if (item.name === "write_file")
    return success("write_file", `wrote ${item.arguments.path} (${bytes(item.arguments.content)} bytes)`, { files: [item.arguments.path] })
  if (item.name === "install_dependencies") return success("install_dependencies", "added 128 packages in 4s\n(exit code 0)")
  if (item.name === "run_tests") return success("run_tests", "2 passed in 0.31s\n(exit code 0)")
  if (item.name === "run_shell") return success("run_shell", "(no output)\n(exit code 0)")
  if (item.name === "inspect_diagnostics") return success("inspect_diagnostics", "Found 0 errors.\n(exit code 0)")
  if (item.name === "project_structure") return success("project_structure", tree(project))
  if (item.name === "list_directory") return success("list_directory", directoryEntries(project, item.arguments.path ?? ".").join("\n"))
  if (item.name === "search_code") return success("search_code", searchLines(project, item.arguments.query))
  if (item.name === "find_symbols") {
    const prefix = (item.arguments.path ?? ".").replace(/\/$/, "")
    const symbols = Object.entries(project.files)
      .filter(([file]) => prefix === "." || file.startsWith(`${prefix}/`))
      .flatMap(([file, text]) => symbolsOf(text, file).map((symbol) => `${file}:${symbol.line}: ${symbol.name}`))
    if (symbols.length === 0) throw new Error(`${project.id}: no symbols under ${prefix}`)
    return success("find_symbols", symbols.slice(0, 50).join("\n"))
  }
  throw new Error(`no fix result for ${item.name}`)
}

/** 13. Task state updates: the model narrates what the state will record, then the tool does it. */
function stateUpdates(counters) {
  const rows = []
  const cases = [
    { project: "node_api", tool: call("write_file", { path: "src/validate.js", content: "module.exports = {}\n" }, "add the validation module the routes need"), text: "State: write initial files is done, src/validate.js is tracked, next is implement remaining files." },
    { project: "node_api", tool: call("install_dependencies", { command: "npm install" }, "the import exists but packages are missing"), text: "State: install dependencies is done, next is run diagnostics." },
    { project: "react_dashboard", tool: call("inspect_diagnostics", { command: "npm run typecheck" }, "diagnostics before reporting"), text: "State: run diagnostics is done and verification records inspect_diagnostics passed; next is verify the result." },
    { project: "react_dashboard", tool: call("run_tests", { command: "npm run test" }, "tests are the real verification"), text: "State: verify the result is done and run_tests passed is recorded. No steps remain." },
    { project: "express_auth", tool: call("edit_file", { path: "src/routes/auth.js", old: "const users = []", new: "const users = []\nconst tokens = new Set()" }, "add the token set the new route needs"), text: "State: the file is tracked and next is run diagnostics; editing alone does not complete verification." },
    { project: "react_login", tool: call("read_file", { path: "src/components/LoginForm.tsx" }, "inspect before editing"), text: "State: analyze requirements is done, next is write an implementation plan. Reading changes the plan, not the files." },
    { project: "crud_api", tool: call("find_symbols", { path: "src" }, "index the declarations before extracting a module"), text: "State: the two symbols are recorded for later prompts; next is implement remaining files." },
    { project: "node_api", tool: call("run_shell", { command: "node --check src/server.js" }, "the syntax check failed once already"), text: "State: shell success does not complete any plan step; the failure stays in errors until a diagnostics or test run passes." },
  ]
  for (const item of cases) {
    const project = projectById(item.project)
    const n = (counters.task_state_update += 1)
    const seeded = baseState(project, `update the state after ${item.tool.name}`, { completed: ["write initial files"], errors: item.tool.name === "run_shell" ? ["run_shell: command-failed: SyntaxError on line 6"] : [] }, n)
    rows.push(
      makeExample({
        id: makeId("task_state_update", `${project.id}_${item.tool.name}`, "en", n),
        category: "task_state_update",
        language: "en",
        difficulty: "medium",
        objective: `what changes in the task state after ${item.tool.name}?`,
        project,
        state: seeded,
        calls: [item.tool],
        results: [fixResult(project, item.tool)],
        response: { text: item.text },
        workspace: [...workspaceOf(project), ...(item.tool.arguments.path ? [item.tool.arguments.path] : [])],
        generator: "generators.stateUpdates",
        seed: n,
      }),
    )
  }
  return rows
}

/** 14. Resumption: the conversation is gone, the state survived, so re-read before continuing. */
function resumption(counters) {
  const rows = []
  const cases = [
    { project: "node_api", objective: "finish the task validation and rerun the tests", file: "src/routes/tasks.js", errors: ["run_tests: command-failed: AssertionError: expected 400"], next: "fix the failing tests" },
    { project: "react_login", objective: "finish making the login button submit", file: "src/components/LoginForm.tsx", errors: [], next: "implement remaining files" },
    { project: "react_dashboard", objective: "finish the reports route", file: "src/App.tsx", errors: [], next: "implement remaining files" },
    { project: "python_cli", objective: "finish the json flag", file: "app.py", errors: ["run_shell: command-failed: unrecognized arguments: --json"], next: "inspect the command error and retry" },
    { project: "html_rtl", objective: "finish the RTL navigation", file: "index.html", errors: [], next: "run diagnostics" },
    { project: "express_auth", objective: "finish token verification", file: "src/middleware/auth.js", errors: ["run_tests: command-failed: expected 401 for an invalid token, got 200"], next: "fix the failing tests" },
  ]
  for (const item of cases) {
    const project = projectById(item.project)
    const n = (counters.task_resumption += 1)
    const state = baseState(
      project,
      item.objective,
      { completed: ["analyze requirements", "write an implementation plan", "create project directories", "write initial files"], files: [item.file], errors: item.errors, next: item.next },
      n,
    )
    rows.push(
      makeExample({
        id: makeId("task_resumption", project.id, "en", n),
        category: "task_resumption",
        language: "en",
        difficulty: "hard",
        objective: `resume: ${item.objective}`,
        project,
        state,
        conversation: [],
        priorResults: [],
        calls: [call("read_file", { path: item.file }, "the conversation was lost, so re-read the file before editing it")],
        results: [readResult(project, item.file)],
        response: { text: `The state says ${item.next}. The conversation is gone, so I will re-read ${item.file} before changing it.` },
        generator: "generators.resumption",
        seed: n,
      }),
    )
  }
  return rows
}

/** 15. Completion: verified work is reported with evidence, unverified work is not. */
function completion(counters) {
  const rows = []
  const verified = [
    ["node_api", "npm test", "ok 1 - lists tasks\nok 2 - rejects an empty title\n# pass 2\n# fail 0\n(exit code 0)"],
    ["python_cli", "python -m pytest -q", "3 passed in 0.24s\n(exit code 0)"],
    ["react_dashboard", "npm run test", "Test Files 2 passed\nTests 6 passed\n(exit code 0)"],
    ["express_auth", "node --test", "ok 1 - registers a user\nok 2 - rejects a duplicate email\n# pass 2\n# fail 0\n(exit code 0)"],
    ["crud_api", "node --test", "ok 1 - creates a note\nok 2 - lists notes\nok 3 - rejects an empty title\n# pass 3\n# fail 0\n(exit code 0)"],
  ]
  for (const [projectId, command, output] of verified) {
    const project = projectById(projectId)
    const n = (counters.completion_verification += 1)
    const result = success("run_tests", output)
    const state = progress(
      baseState(project, `finish ${project.name}`, { completed: ["analyze requirements", "write an implementation plan", "create project directories", "write initial files", "implement remaining files", "install dependencies", "run diagnostics"] }, n),
      result,
    )
    rows.push(
      makeExample({
        id: makeId("completion_verification", project.id, "en", n),
        category: "completion_verification",
        language: "en",
        difficulty: "medium",
        objective: `report the result of ${project.name}`,
        project,
        state,
        priorResults: [result],
        calls: [],
        results: [],
        response: { text: `${project.name} is done: ${command} passes and verification records run_tests passed. All plan steps are complete.`, completion: "done" },
        generator: "generators.completion",
        seed: n,
      }),
    )
  }
  const failing = projectById("react_login")
  const n = (counters.completion_verification += 1)
  const failed = failure("run_tests", "command-failed", "npm run test exited with code 1\nFAILED src/components/LoginForm.test.tsx > submits the form\n1 failed\n(exit code 1)")
  const state = progress(baseState(failing, "finish the login form", { completed: ["write initial files", "implement remaining files", "run diagnostics"] }, n), failed)
  rows.push(
    makeExample({
      id: makeId("completion_verification", "not_verified", "en", n),
      category: "completion_verification",
      language: "en",
      difficulty: "hard",
      objective: "report the login form result",
      project: failing,
      state,
      priorResults: [failed],
      calls: [],
      results: [],
      response: { text: "The login form test still fails, so the task is not complete. The submit handler runs but the test expects the mocked fetch to be called once.", completion: "blocked" },
      generator: "generators.completion",
      seed: n,
    }),
  )
  const unrun = projectById("html_rtl")
  const m = (counters.completion_verification += 1)
  rows.push(
    makeExample({
      id: makeId("completion_verification", "no_verification", "fa", m),
      category: "completion_verification",
      language: "fa",
      difficulty: "medium",
      objective: "گزارش نهایی صفحه RTL را بده",
      project: unrun,
      state: baseState(unrun, "چیدمان RTL", { completed: ["write initial files", "implement remaining files"], files: ["styles.css"], next: "verify the result" }, m),
      calls: [],
      results: [],
      response: { text: "تغییرات اعمال شده اما هیچ تست یا ابزار بررسی اجرا نشده است. نمی‌توانم بگویم کار تأیید شده؛ ابتدا باید بررسی اجرا شود.", completion: "blocked" },
      generator: "generators.completion",
      seed: m,
    }),
  )
  return rows
}

/** Tool-argument failures that are representable without malformed JSON: wrong shape and missing fields. */
function argumentFailures(counters) {
  const rows = []
  const project = projectById("react_login")
  const cases = [
    {
      id: "write_file_missing_path",
      tool: call("write_file", { content: "export default function App() { return null }\n" }, "write the component without naming the file"),
      result: failure("write_file", "invalid-arguments", "write_file expects { path, content }"),
      text: "write_file needs a path; the call has none, so nothing was written. Retry with both fields.",
    },
    {
      id: "edit_file_missing_old",
      tool: call("edit_file", { path: "src/components/LoginForm.tsx", new: "onClick={submit}" }, "target the button without quoting the old text"),
      result: failure("edit_file", "invalid-arguments", "edit_file expects { path, old, new }"),
      text: "edit_file needs the exact old text. Without it the edit cannot be placed, so I must read the file and supply old and new.",
    },
    {
      id: "read_file_wrong_type",
      tool: call("read_file", { path: 42 }, "a numeric path is not a path"),
      result: failure("read_file", "invalid-arguments", "read_file expects { path, start?, end? } with integer lines"),
      text: "The path argument must be a string. Use the file path from the task state.",
    },
    {
      id: "search_code_empty",
      tool: call("search_code", { query: "" }, "search with an empty query"),
      result: failure("search_code", "invalid-arguments", "query must not be empty"),
      text: "An empty query cannot match. Search for the symbol or string that identifies the code.",
    },
    {
      id: "run_shell_empty",
      tool: call("run_shell", { command: "   " }, "run an empty command"),
      result: failure("run_shell", "invalid-arguments", "command must not be empty"),
      text: "The command is empty, so nothing ran. Provide the exact command to execute.",
    },
    {
      id: "edit_no_match",
      tool: call("edit_file", { path: "src/App.tsx", old: "const title = 'Login'", new: "const title = 'Sign in'" }, "edit text that may not exist"),
      result: failure("edit_file", "no-match", "src/App.tsx does not contain the old text"),
      text: "The old text is not in App.tsx. Read the file before choosing the text to replace.",
    },
    {
      id: "edit_ambiguous",
      tool: call("edit_file", { path: "src/styles.css", old: "#root", new: "#app" }, "replace a selector that repeats"),
      result: failure("edit_file", "ambiguous-match", "src/styles.css contains the old text more than once"),
      text: "The selector appears more than once, so the edit is ambiguous. Include surrounding lines to target one occurrence.",
    },
    {
      id: "read_missing_file",
      tool: call("read_file", { path: "src/server.ts" }, "read a file that does not exist in this project"),
      result: failure("read_file", "not-found", "src/server.ts could not be read"),
      text: "src/server.ts does not exist; this project uses src/App.tsx. List the directory to confirm the real path.",
    },
  ]
  for (const item of cases) {
    const n = (counters.file_editing += 1)
    rows.push(
      makeExample({
        id: makeId("file_editing", item.id, "en", n),
        category: "file_editing",
        language: "en",
        difficulty: "medium",
        objective: `recover from a tool call that cannot succeed: ${item.id.replaceAll("_", " ")}`,
        project,
        state: baseState(project, `recover from ${item.id}`, {}, n),
        calls: [item.tool],
        results: [item.result],
        response: { text: item.text },
        workspace: [...workspaceOf(project), "src/styles.css"],
        generator: "generators.argumentFailures",
        seed: n,
      }),
    )
  }
  return rows
}

/** The same real steps with Persian objectives and explanations, so the language signal is not limited to failures. */
function persianSteps(counters) {
  const rows = []
  for (const { project, goal } of persianGoals()) {
    const n = (counters.task_planning += 1)
    const secondFile = Object.keys(project.files).find((file) => file !== entryFile(project)) ?? entryFile(project)
    rows.push(
      makeExample({
        id: makeId("task_planning", `${project.id}_fa`, "fa", n),
        category: "task_planning",
        language: "fa",
        difficulty: "medium",
        objective: `برنامه کار برای: ${goal}`,
        project,
        state: baseState(project, goal, {}, n),
        plan: WORKFLOW.slice(0, 5),
        calls: [call("list_directory", { path: "." }, "plan against the files that already exist")],
        results: [success("list_directory", directoryEntries(project, ".").join("\n"))],
        response: {
          text: `برنامه برای «${goal}»: ابتدا ${entryFile(project)} را می‌خوانم، بعد تغییر را در ${entryFile(project)} و ${secondFile} انجام می‌دهم، سپس بررسی خطاها و اجرای تست‌ها. با فهرست ${project.name} شروع می‌کنم.`,
        },
        generator: "generators.persianSteps",
        seed: n,
      }),
    )
  }
  for (const project of PROJECTS) {
    const n = (counters.project_structure += 1)
    rows.push(
      makeExample({
        id: makeId("project_structure", `${project.id}_fa`, "fa", n),
        category: "project_structure",
        language: "fa",
        difficulty: "easy",
        objective: `ساختار ${project.name} را نشان بده`,
        project,
        state: baseState(project, `مرور ساختار ${project.name}`, {}, n),
        plan: ["analyze requirements"],
        calls: [call("project_structure", { depth: 2 }, "shallow tree is enough to choose the next file")],
        results: [success("project_structure", tree(project, 2))],
        response: { text: `درخت ${project.name} شامل ${Object.keys(project.files).length} فایل است و نقطه ورود ${entryFile(project)} است؛ بقیه فایل‌ها زیرپوشه‌های همان مسیر هستند.` },
        generator: "generators.persianSteps",
        seed: n,
      }),
    )
    const m = (counters.file_reading += 1)
    const path = entryFile(project)
    rows.push(
      makeExample({
        id: makeId("file_reading", `${project.id}_fa`, "fa", m),
        category: "file_reading",
        language: "fa",
        difficulty: "easy",
        objective: `فایل ${path} را در ${project.name} بخوان`,
        project,
        state: baseState(project, `خواندن ${path}`, {}, m),
        calls: [call("read_file", { path }, `read the entry file of ${project.name}`)],
        results: [success("read_file", project.files[path])],
        response: { text: `${path} را خواندم؛ ${project.files[path].split("\n").length} خط دارد و از بخش import شروع می‌شود.` },
        generator: "generators.persianSteps",
        seed: m,
      }),
    )
  }
  return rows
}

/** Done and blocked after real evidence: the state and the sentence must agree with the results. */
function completionExtras(counters) {
  const project = projectById("node_api")
  const rows = []
  const n = (counters.completion_verification += 1)
  const installed = baseState(
    project,
    "install dependencies and run the suite",
    { completed: ["write initial files", "install dependencies", "verify the result"], verification: ["run_tests passed"] },
    n,
  )
  rows.push(
    makeExample({
      id: makeId("completion_verification", "install_then_tests", "en", n),
      category: "completion_verification",
      language: "en",
      difficulty: "medium",
      objective: "report after installing and running the tests",
      project,
      state: installed,
      priorResults: [
        success("install_dependencies", "added 128 packages in 4s\n(exit code 0)"),
        success("run_tests", "2 passed in 0.31s\n(exit code 0)"),
      ],
      plan: WORKFLOW,
      calls: [],
      results: [],
      response: {
        text: "Dependencies are installed and both tests pass, so the task is complete. The recorded verification is run_tests passed.",
        completion: "done",
      },
      generator: "generators.completionExtras",
      seed: n,
    }),
  )
  const m = (counters.completion_verification += 1)
  const failing = baseState(
    project,
    "typecheck the project before reporting",
    { completed: ["write initial files", "run diagnostics"], errors: ["inspect_diagnostics: command-failed: src/routes/tasks.js(12,7): error TS2551"] },
    m,
  )
  rows.push(
    makeExample({
      id: makeId("completion_verification", "typecheck_failing", "en", m),
      category: "completion_verification",
      language: "en",
      difficulty: "medium",
      objective: "report the typecheck result honestly",
      project,
      state: failing,
      priorResults: [
        failure("inspect_diagnostics", "command-failed", "npm run typecheck exited with code 1\nsrc/routes/tasks.js(12,7): error TS2551: Property 'title' does not exist on type 'Task'"),
      ],
      plan: WORKFLOW,
      calls: [],
      results: [],
      response: {
        text: "The typecheck still fails on src/routes/tasks.js line 12: the Task type has no title field. The task is not complete until that error is fixed and the check passes.",
        completion: "blocked",
      },
      generator: "generators.completionExtras",
      seed: m,
    }),
  )
  return rows
}

/** The same "show me" answers with Persian explanations around the code. */
function codeExplanationFa(counters) {
  return SNIPPETS.filter((snippet, index) => index % 3 === 0).map((snippet, index) => {
    const project = projectById(snippet.projectId)
    const n = (counters.code_generation += 1)
    return makeExample({
      id: makeId("code_generation", `${snippet.id}_fa`, "fa", n),
      category: "code_generation",
      language: "fa",
      difficulty: "medium",
      objective: `کد این کار را نشان بده: ${snippet.goal.en}`,
      project,
      state: baseState(project, snippet.goal.en, {}, index),
      plan: [],
      calls: [],
      results: [],
      response: {
        text: `این کوچک‌ترین پیاده‌سازی است که این رفتار را انجام می‌دهد. ورودی نامعتبر رد می‌شود و هیچ حالت مرزی بی‌پاسخ نمی‌ماند.\n\n\`\`\`${snippet.fence}\n${snippet.code}\n\`\`\``,
        completion: "done",
      },
      generator: "generators.codeExplanationFa",
      seed: index,
    })
  })
}

export function generateAll() {
  const counters = {
    intent_understanding: 0,
    requirement_extraction: 0,
    file_creation: 0,
    task_planning: 0,
    project_structure: 0,
    file_reading: 0,
    code_generation: 0,
    dependency_installation: 0,
    diagnostics: 0,
    test_execution: 0,
    error_recovery: 0,
    task_state_update: 0,
    task_resumption: 0,
    completion_verification: 0,
    file_editing: 0,
  }
  const rows = [
    ...intent(counters),
    ...requirements(counters),
    ...planning(counters),
    ...structure(counters),
    ...reading(counters),
    ...codeWork(counters),
    ...codeExplanation(counters),
    ...dependencies(counters),
    ...diagnostics(counters),
    ...tests(counters),
    ...recovery(counters),
    ...stateUpdates(counters),
    ...resumption(counters),
    ...completion(counters),
    ...argumentFailures(counters),
    ...persianSteps(counters),
    ...completionExtras(counters),
    ...codeExplanationFa(counters),
  ]
  return { rows, counters }
}
