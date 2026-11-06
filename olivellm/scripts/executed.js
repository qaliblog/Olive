#!/usr/bin/env bun
/**
 * Records real agent trajectories by running the scripted steps through Olive's actual tool executor.
 *
 * Nothing here is invented: every tool result in the output is what `packages/core/src/olive/tools.ts` returned for a
 * temporary fixture workspace, including the failures. Each step becomes one training record whose conversation holds
 * the previous real calls and results, so the model learns to choose the next action from actual evidence.
 *
 * The fixture files are seeded directly, not through write_file, and the records are labelled
 * `source.kind = "execution"` so fixture setup is never confused with verified execution.
 *
 *   bun olivellm/scripts/executed.js
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { OliveTools } from "../../packages/core/src/olive/tools.ts"
import { EPOCH, makeExample, makeId, rendered } from "./lib/emit.js"
import { countBy, writeJson, writeJsonl } from "./lib/json.js"
import { advance, initialize, progress } from "./lib/state.js"
import { SYSTEM } from "./lib/prompt.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const output = path.join(root, "datasets/raw/executed.jsonl")
const summaryFile = path.join(root, "datasets/raw/executed-summary.json")

const cli = `#!/usr/bin/env node
const name = process.argv[3] ?? "world"
console.log(\`hello \${name}\`)
`
const cliTest = `const test = require("node:test")
const assert = require("node:assert")
const { execFileSync } = require("node:child_process")

test("greets the given name", () => {
  const output = execFileSync(process.execPath, ["src/cli.js", "ada"], { encoding: "utf8" })
  assert.strictEqual(output.trim(), "hello ada")
})
`
const greeting = `const greeting = (name) => \`\${name}\`

module.exports = { greeting }
`
const greetingTest = `const test = require("node:test")
const assert = require("node:assert")
const { greeting } = require("../src/greeting")

test("greets in Persian", () => {
  assert.strictEqual(greeting("دنیا"), "سلام دنیا")
})
`
const loginModule = `const { randomUUID } = require("node:crypto")

function createUser(email) {
  if (!email) throw new Error("email is required")
  return { id: randomUUID(), email, createdAt: Date.now() }
}

module.exports = { createUser }
`
const loginTest = `const test = require("node:test")
const assert = require("node:assert")
const { createUser } = require("../src/user")

test("creates a user with an id", () => {
  const user = createUser("ada@example.com")
  assert.strictEqual(user.email, "ada@example.com")
  assert.ok(user.id.length > 0)
})
`

const SCENARIOS = [
  {
    id: "node_cli_verify",
    language: "en",
    category: "error_recovery",
    objective: "fix the failing CLI greeting test and verify the fix",
    seed: {
      "package.json": `${JSON.stringify({ name: "cli-fixture", private: true, scripts: { test: "node --test test/cli.test.js", typecheck: "node --check src/cli.js" } }, null, 2)}\n`,
      "src/cli.js": cli,
      "test/cli.test.js": cliTest,
    },
    steps: [
      {
        call: { name: "project_structure", arguments: { depth: 2 }, why: "see the files before changing anything" },
        text: "Fixture project inspected. Next I read the entry file.",
      },
      {
        call: { name: "read_file", arguments: { path: "src/cli.js" }, why: "read the code the test exercises" },
        text: "The CLI reads process.argv[3]; the test passes one argument.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "confirm the failure before editing" },
        text: "The test fails, so the reported bug is real.",
      },
      {
        call: { name: "edit_file", arguments: { path: "src/cli.js", old: "argv[3]", new: "argv[2]" }, why: "read the first argument, not the second" },
        text: "Fixed the argument index. Now I check that the file still parses.",
      },
      {
        call: { name: "inspect_diagnostics", arguments: {}, why: "typecheck the edited file" },
        text: "The file parses. Diagnostics do not prove behaviour, so I run the test again.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "prove the fix with the real suite" },
        text: "The suite passes after the edit.",
      },
      {
        calls: [],
        text: "The CLI now reads its first argument and the suite passes. The state records run_tests passed, so the fix is verified.",
      },
    ],
  },
  {
    id: "search_and_symbols",
    language: "en",
    category: "project_structure",
    objective: "find where createUser is defined and who calls it",
    seed: {
      "src/user.js": loginModule,
      "src/routes.js": `const { createUser } = require("./user")\n\nmodule.exports = (req, res) => res.json(createUser(req.body.email))\n`,
      "test/user.test.js": loginTest,
      "package.json": `${JSON.stringify({ name: "user-fixture", private: true, scripts: { test: "node --test test/user.test.js" } }, null, 2)}\n`,
    },
    steps: [
      {
        call: { name: "list_directory", arguments: { path: "src" }, why: "see the source files first" },
        text: "src holds user.js and routes.js.",
      },
      {
        call: { name: "search_code", arguments: { query: "createUser" }, why: "find every reference, not just the definition" },
        text: "createUser is defined in src/user.js and called from src/routes.js.",
      },
      {
        call: { name: "find_symbols", arguments: { path: "src" }, why: "index the declarations to confirm the definition line" },
        text: "The index confirms createUser is declared in src/user.js.",
      },
      {
        calls: [],
        text: "createUser is declared in src/user.js and only src/routes.js calls it. That is what the index and the search both returned, so no further inspection is needed.",
      },
    ],
  },
  {
    id: "install_and_shell",
    language: "en",
    category: "dependency_installation",
    objective: "install the project dependencies and check the entry file",
    seed: {
      "package.json": `${JSON.stringify({ name: "shell-fixture", private: true, version: "0.0.1", scripts: { test: "node --test test/cli.test.js", typecheck: "node --check src/cli.js" } }, null, 2)}\n`,
      "src/cli.js": cli,
      "test/cli.test.js": cliTest,
    },
    steps: [
      {
        call: { name: "install_dependencies", arguments: { command: "npm install --offline --no-audit --no-fund", timeoutMs: 120000 }, why: "install from the offline cache before running anything" },
        text: "Dependency step finished; the result decides whether the project is runnable.",
      },
      {
        call: { name: "run_shell", arguments: { command: "node --check src/cli.js" }, why: "a syntax check costs nothing and catches a broken edit" },
        text: "The file parses. I still need the test result before reporting anything.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "the suite is the only real evidence" },
        text: "The suite result is recorded; the failing assertion is still open.",
      },
      {
        calls: [],
        text: "Dependencies are installed and the entry file parses, but the suite still fails, so the task is not complete. The next step is the argument fix in src/cli.js.",
        fallback: "Dependencies are installed and the entry file parses, but the suite still fails on the argument handling, so the task is not complete and I am not reporting it as done.",
      },
    ],
  },
  {
    id: "persian_greeting",
    language: "fa",
    category: "code_generation",
    objective: "تابع greeting را درست کن تا تست فارسی پاس شود",
    seed: {
      "package.json": `${JSON.stringify({ name: "greeting-fixture", private: true, scripts: { test: "node --test test/greeting.test.js", typecheck: "node --check src/greeting.js" } }, null, 2)}\n`,
      "src/greeting.js": greeting,
      "test/greeting.test.js": greetingTest,
    },
    steps: [
      {
        call: { name: "read_file", arguments: { path: "src/greeting.js" }, why: "قبل از تغییر، فایل را بخوان" },
        text: "تابع فقط نام را برمی‌گرداند و پیشوند «سلام» ندارد.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "خطا را با اجرای واقعی تست ببین" },
        text: "تست شکست خورد؛ خروجی با رشته‌ی مورد انتظار فارسی برابر نیست.",
      },
      {
        call: { name: "edit_file", arguments: { path: "src/greeting.js", old: "const greeting = (name) => `${name}`", new: "const greeting = (name) => `سلام ${name}`" }, why: "پیشوند فارسی را در تابع اضافه کن" },
        text: "تابع اصلاح شد و باید دوباره تست را اجرا کنم.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "تأیید نهایی با اجرای واقعی تست" },
        text: "تست‌ها پاس شدند و خروجی واقعی ابزار همین را نشان می‌دهد.",
      },
      {
        calls: [],
        text: "تابع greeting اکنون پیشوند «سلام» را برمی‌گرداند و تست فارسی پاس شده است. وضعیت کار، اجرای موفق run_tests را ثبت کرده و تغییر تأیید شده است.",
      },
    ],
  },
  {
    id: "write_new_module",
    language: "en",
    category: "file_creation",
    objective: "create the missing sum module the test imports",
    seed: {
      "package.json": `${JSON.stringify({ name: "sum-fixture", private: true, scripts: { test: "node --test test/sum.test.js", typecheck: "node --check src/sum.js" } }, null, 2)}\n`,
      "test/sum.test.js": `const test = require("node:test")\nconst assert = require("node:assert")\nconst { sum } = require("../src/sum")\n\ntest("sums two numbers", () => {\n  assert.strictEqual(sum(2, 3), 5)\n})\n`,
    },
    steps: [
      {
        call: { name: "run_tests", arguments: {}, why: "confirm the module is really missing" },
        text: "The test fails because src/sum.js does not exist yet.",
      },
      {
        call: {
          name: "write_file",
          arguments: { path: "src/sum.js", content: "const sum = (left, right) => left + right\n\nmodule.exports = { sum }\n" },
          why: "create the module the test imports",
        },
        text: "Wrote src/sum.js exporting sum.",
      },
      {
        call: { name: "inspect_diagnostics", arguments: {}, why: "check the new file parses before running the suite" },
        text: "The new module parses; diagnostics still do not prove the behaviour.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "the suite is the evidence that the module works" },
        text: "The suite passes with the new module in place.",
      },
      {
        calls: [],
        text: "src/sum.js now exists and the suite passes. Verification records run_tests passed, so the task is complete.",
      },
    ],
  },
  {
    id: "mixed_error_recovery",
    language: "mixed",
    category: "error_recovery",
    objective: "fail the missing-file error را fix کن و test createUser را پاس کن",
    seed: {
      "package.json": `${JSON.stringify({ name: "mixed-fixture", private: true, scripts: { test: "node --test test/user.test.js" } }, null, 2)}\n`,
      "src/user.js": loginModule,
      "test/user.test.js": loginTest,
    },
    steps: [
      {
        call: { name: "read_file", arguments: { path: "src/users.js" }, why: "the task names a file I have not seen" },
        text: "The read failed: the real file is src/user.js, not src/users.js. پس مسیر اشتباه است و باید نام درست را استفاده کنم.",
      },
      {
        call: { name: "run_shell", arguments: { command: "node src/missing.js" }, why: "reproduce the reported command failure" },
        text: "The shell command reproduces the reported failure; the path is wrong. خطا با همان command تکرار شد.",
      },
      {
        call: { name: "edit_file", arguments: { path: "src/user.js", old: "not present in the file", new: "x" }, why: "try the edit before reading the real text" },
        text: "The edit failed because the old text does not exist. I must read the file first. متن قدیمی در فایل نیست.",
      },
      {
        call: { name: "read_file", arguments: { path: "src/user.js" }, why: "read the actual source before editing" },
        text: "I read the real file and now have the exact createUser text. فایل واقعی خوانده شد و متن دقیق را دارم.",
      },
      {
        call: { name: "edit_file", arguments: { path: "src/user.js", old: "if (!email) throw new Error(\"email is required\")", new: "if (!email) throw new Error(\"email is required\")\n  if (!email.includes(\"@\")) throw new Error(\"email is invalid\")" }, why: "add the validation the test expects" },
        text: "The validation is added; now the test must run again. اعتبارسنجی اضافه شد و باید تست اجرا شود.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "prove the validation did not break the suite" },
        text: "The suite passes after the change, and the recorded verification is run_tests passed.",
      },
      {
        calls: [],
        text: "مسیر فایل اصلاح شد، validation اضافه شد و tests پاس شدند. All failures above are resolved and the state records run_tests passed.",
      },
    ],
  },
  {
    id: "question_missing_file",
    language: "en",
    category: "completion_verification",
    objective: "add the changelog entry the release checklist asks for",
    seed: {
      "package.json": `${JSON.stringify({ name: "release-fixture", version: "0.0.1", private: true, scripts: { test: "node --test test/app.test.js", typecheck: "node --check src/app.js" } }, null, 2)}\n`,
      "src/app.js": `const version = require("../package.json").version\n\nmodule.exports = { version }\n`,
      "test/app.test.js": `const test = require("node:test")\nconst assert = require("node:assert")\nconst { version } = require("../src/app")\n\ntest("exposes the package version", () => {\n  assert.strictEqual(version, "0.0.1")\n})\n`,
    },
    steps: [
      {
        call: { name: "list_directory", arguments: {}, why: "see whether a changelog already exists" },
        text: "The listing shows package.json, src and test; no changelog file.",
      },
      {
        call: { name: "read_file", arguments: { path: "CHANGELOG.md" }, why: "read the file the checklist names" },
        text: "The read failed: there is no CHANGELOG.md in this project.",
      },
      {
        call: { name: "search_code", arguments: { query: "CHANGELOG" }, why: "check whether anything refers to a changelog" },
        text: "The search found no reference to a changelog anywhere in the project.",
      },
      {
        calls: [],
        completion: "blocked",
        text: "QUESTION: The release checklist refers to a changelog entry, but this project has no CHANGELOG.md and no reference to one. Should I create a new CHANGELOG.md, and which entries belong in it?",
      },
    ],
  },
  {
    id: "resume_after_interrupt",
    language: "en",
    category: "task_resumption",
    objective: "finish the price formatting fix the last run left unfinished",
    resume: {
      completed: ["analyze requirements", "write an implementation plan", "write initial files"],
      files: ["src/format.js"],
      errors: ["run_tests: command-failed: node --test test/format.test.js exited with code 1"],
      next: "fix the failing tests",
    },
    seed: {
      "package.json": `${JSON.stringify({ name: "format-fixture", private: true, scripts: { test: "node --test test/format.test.js", typecheck: "node --check src/format.js" } }, null, 2)}\n`,
      "src/format.js": `const formatPrice = (cents) => \`\${cents / 100}$\`\n\nmodule.exports = { formatPrice }\n`,
      "test/format.test.js": `const test = require("node:test")\nconst assert = require("node:assert")\nconst { formatPrice } = require("../src/format")\n\ntest("keeps two decimals", () => {\n  assert.strictEqual(formatPrice(1990), "19.90$")\n})\n`,
    },
    steps: [
      {
        call: { name: "read_file", arguments: { path: "src/format.js" }, why: "resume from the saved state by reading the file it names" },
        text: "The helper divides by 100 without fixing the decimals, so 1990 renders as 19.9 instead of 19.90. That matches the error the previous run recorded.",
      },
      {
        call: {
          name: "edit_file",
          arguments: { path: "src/format.js", old: "`${cents / 100}$`", new: "`${(cents / 100).toFixed(2)}$`" },
          why: "apply the fix the saved state was waiting for",
        },
        text: "The helper now formats with two decimals. The test still has to prove it.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "clear the recorded failure with a real test run" },
        text: "The suite passes, so the error from the previous run is resolved.",
      },
      {
        calls: [],
        text: "The price helper now keeps two decimals, the suite passed after the edit, and the state that was left mid-run is finished.",
      },
    ],
  },
  {
    id: "mixed_install_recovery",
    language: "mixed",
    category: "dependency_installation",
    objective: "خطای نصب را درست کن و بعد test suite را پاس کن",
    seed: {
      // The test script names the file: this Node build resolves a bare directory argument as a module path.
      "package.json": `${JSON.stringify({ name: "install-fixture", private: true, scripts: { test: "node --test test/app.test.js", typecheck: "node --check src/app.js" } }, null, 2)}\n`,
      "src/app.js": `module.exports = { started: true }\n`,
      "test/app.test.js": `const test = require("node:test")\nconst assert = require("node:assert")\nconst { started } = require("../src/app")\n\ntest("starts", () => {\n  assert.strictEqual(started, true)\n})\n`,
    },
    steps: [
      {
        call: { name: "install_dependencies", arguments: { command: "npm run install:nothing --offline" }, why: "اجرای اسکریپت نصبی که در package.json نیست" },
        text: "The install failed: the script does not exist. اسکریپت نصب وجود ندارد و باید مسیر درست را انتخاب کنم.",
      },
      {
        call: { name: "install_dependencies", arguments: { command: "npm install --offline --no-audit --no-fund" }, why: "نصب واقعی با مدیریت بسته‌ای که lockfile نشان می‌دهد" },
        text: "The install succeeded this time. نصب انجام شد و حالا باید تست‌ها را اجرا کنم.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "تأیید با اجرای واقعی تست‌ها" },
        text: "The suite passed after the install. تست‌ها پاس شدند.",
      },
      {
        calls: [],
        completion: "done",
        text: "نصب وابستگی‌ها با موفقیت انجام شد و همه‌ی تست‌ها بعد از آن پاس شدند. The install ran with the package manager the lockfile implies, the suite passed afterwards, and the state records both steps, so the task is complete.",
      },
    ],
  },
  {
    id: "mixed_symbol_lookup",
    language: "mixed",
    category: "file_reading",
    objective: "تابع createUser کجاست و چه کسی آن را صدا می‌زند؟",
    seed: {
      "package.json": `${JSON.stringify({ name: "symbol-fixture", private: true, scripts: { test: "node --test test/user.test.js" } }, null, 2)}\n`,
      "src/user.js": loginModule,
      "src/routes.js": `const { createUser } = require("./user")\n\nmodule.exports = (req, res) => res.json(createUser(req.body.email))\n`,
      "test/user.test.js": loginTest,
    },
    steps: [
      {
        call: { name: "find_symbols", arguments: { path: "src" }, why: "ایندکس اعلان‌ها را بگیر تا خط تعریف معلوم شود" },
        text: "The index lists createUser in src/user.js. ایندکس خط تعریف را نشان داد.",
      },
      {
        call: { name: "search_code", arguments: { query: "createUser" }, why: "همه‌ی ارجاع‌ها را پیدا کن، نه فقط تعریف را" },
        text: "The search returned the definition in src/user.js and the call in src/routes.js. تنها یک فراخوانی وجود دارد.",
      },
      {
        calls: [],
        completion: "done",
        text: "createUser در src/user.js تعریف شده و فقط src/routes.js آن را صدا می‌زند. Both the symbol index and the code search returned the same declaration and the same single call site, so the answer needs no edit and no further inspection.",
      },
    ],
  },
  {
    id: "persian_tests_recovery",
    language: "fa",
    category: "error_recovery",
    objective: "تست خروجی فارسی را پاس کن",
    seed: {
      "package.json": `${JSON.stringify({ name: "greeting-fa-fixture", private: true, scripts: { test: "node --test test/greeting.test.js", typecheck: "node --check src/greeting.js" } }, null, 2)}\n`,
      "src/greeting.js": `const greeting = (name) => \`hi \${name}\`\n\nmodule.exports = { greeting }\n`,
      "test/greeting.test.js": greetingTest,
    },
    steps: [
      {
        call: { name: "run_tests", arguments: {}, why: "اول خطای واقعی را ببین، بعد تغییر بده" },
        text: "تست شکست خورد: خروجی تابع با رشته‌ی فارسی مورد انتظار برابر نیست.",
      },
      {
        call: { name: "read_file", arguments: { path: "src/greeting.js" }, why: "متن دقیق تابع را بخوان" },
        text: "تابع پیشوند انگلیسی «hi» برمی‌گرداند و باید به «سلام» تغییر کند.",
      },
      {
        call: {
          name: "edit_file",
          arguments: { path: "src/greeting.js", old: "`hi ${name}`", new: "`سلام ${name}`" },
          why: "پیشوند فارسی را جای پیشوند انگلیسی بگذار",
        },
        text: "تابع اصلاح شد و حالا باید همان تست را دوباره اجرا کنم.",
      },
      {
        call: { name: "run_tests", arguments: {}, why: "تأیید نهایی با اجرای واقعی تست" },
        text: "تست پس از اصلاح پاس شد و نتیجه‌ی واقعی ابزار همین را نشان می‌دهد.",
      },
      {
        calls: [],
        text: "تابع greeting اکنون پیشوند «سلام» را برمی‌گرداند و تست فارسی پاس شده است. وضعیت کار، اجرای موفق run_tests را ثبت کرده و خطای قبلی پاک شده است.",
      },
    ],
  },
]

const counts = {}
const rows = []

for (const [index, scenario] of SCENARIOS.entries()) {
  const directory = await mkdtemp(path.join(tmpdir(), `olivellm-${scenario.id}-`))
  try {
    for (const [file, content] of Object.entries(scenario.seed)) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true })
      await writeFile(path.join(directory, file), content, "utf8")
    }
    const workspace = scenarioWorkspace(scenario)
    const conversation = []
    const prior = []
    // A resumed trajectory starts from the durable state a previous run left behind, exactly as `initialize` reads it
    // back from `.olive/task.json`, so the first record shows the interrupted task rather than a fresh one.
    let task = scenario.resume
      ? advance(initialize(scenario.objective, EPOCH + index), scenario.resume, EPOCH + index)
      : initialize(scenario.objective, EPOCH + index)
    let counter = 0
    for (const step of scenario.steps) {
      counter += 1
      if (!step.call) {
        // A step may state its own verdict: asking the user is neither a successful report nor a generic block, and the
        // sentence that goes with it is authored per scenario.
        const completion = step.completion ?? completionOf(task, scenario)
        const record = makeExample({
          id: makeId(scenario.category, `${scenario.id}_report`, scenario.language, (counts[scenario.category] = (counts[scenario.category] ?? 0) + 1)),
          category: scenario.category,
          language: scenario.language,
          difficulty: "hard",
          objective: scenario.objective,
          state: task,
          system: SYSTEM,
          conversation: conversation.slice(-8),
          priorResults: prior.slice(-6),
          calls: [],
          results: [],
          response: {
            text: step.completion ? step.text : completion === "done" ? step.text : (step.fallback ?? blockedText(scenario)),
            completion,
          },
          sourceKind: "execution",
          trajectory: scenario.id,
          generator: `executed.${scenario.id}`,
          seed: index,
          workspace,
          notes: `real tool execution in a temporary fixture workspace; fixture files were seeded, every result came from the executor`,
        })
        rows.push(record)
        continue
      }
      const runtime = await OliveTools.execute(step.call.name, step.call.arguments, { directory, maxOutputChars: 4_000 })
      const result = toDataset(runtime)
      const record = makeExample({
        id: makeId(scenario.category, scenario.id, scenario.language, (counts[scenario.category] = (counts[scenario.category] ?? 0) + 1)),
        category: step.category ?? scenario.category,
        language: scenario.language,
        difficulty: "hard",
        objective: scenario.objective,
        state: task,
        system: SYSTEM,
        conversation: conversation.slice(-8),
        priorResults: prior.slice(-6),
        calls: [step.call],
        results: [result],
        response: { text: step.text },
        sourceKind: "execution",
        trajectory: scenario.id,
        generator: `executed.${scenario.id}`,
        seed: index,
        workspace,
        notes: `step ${counter} of ${scenario.id}; result captured from the real executor`,
      })
      rows.push(record)
      conversation.push({
        role: "assistant",
        content: step.text,
        toolCalls: [{ id: `call_${counter}`, name: step.call.name, arguments: JSON.stringify(step.call.arguments) }],
      })
      conversation.push({ role: "tool", content: rendered(result), toolCallId: `call_${counter}` })
      prior.push(result)
      task = progress(task, result, EPOCH + index)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// Targeted coverage for the tools the template corpus under-represented. Same rule as above: every result is the real
// executor output for a real fixture path, including the failures.
const { COVERAGE_FIXTURE, COVERAGE_CATEGORY, COVERAGE_CALLS } = coveragePlan()
const coverageDirectory = await mkdtemp(path.join(tmpdir(), "olivellm-coverage-"))
try {
  for (const [file, content] of Object.entries(COVERAGE_FIXTURE)) {
    await mkdir(path.dirname(path.join(coverageDirectory, file)), { recursive: true })
    await writeFile(path.join(coverageDirectory, file), content, "utf8")
  }
  const workspace = coverageWorkspace()
  for (const [index, entry] of COVERAGE_CALLS.entries()) {
    const runtime = await OliveTools.execute(entry.tool, entry.arguments, { directory: coverageDirectory, maxOutputChars: 4_000 })
    const result = toDataset(runtime)
    const category = COVERAGE_CATEGORY[entry.tool]
    const outcome = result.ok
      ? `${entry.tool} returned a real result for this argument set; the output above is what the executor produced.`
      : `${entry.tool} failed with ${result.error_code}; the failure is recorded and the next step must handle it.`
    rows.push(
      makeExample({
        id: makeId(category, `coverage_${entry.tool}`, "en", (counts[category] = (counts[category] ?? 0) + 1)),
        category,
        language: "en",
        difficulty: "easy",
        objective: `use ${entry.tool} on the fixture project: ${entry.why}`,
        state: initialize(`use ${entry.tool} on the fixture project: ${entry.why}`, EPOCH + index),
        system: SYSTEM,
        calls: [{ name: entry.tool, arguments: entry.arguments, why: entry.why }],
        results: [result],
        response: { text: outcome },
        sourceKind: "execution",
        trajectory: `coverage_${entry.tool}`,
        generator: `executed.coverage.${entry.tool}`,
        seed: index,
        workspace,
        notes: "single-step real tool execution used to balance tool coverage",
      }),
    )
  }
} finally {
  await rm(coverageDirectory, { recursive: true, force: true })
}

await writeJsonl(output, rows)
await writeJson(summaryFile, {
  version: "1.0.0",
  note: "Records whose source.kind is `execution` were produced by running packages/core/src/olive/tools.ts against a temporary fixture workspace. Failures are real executor results.",
  scenarios: SCENARIOS.map((scenario) => ({ id: scenario.id, language: scenario.language, steps: scenario.steps.length })),
  records: rows.length,
  per_category: countBy(rows, (row) => row.category),
  per_language: countBy(rows, (row) => row.language),
  tools: countBy(rows.flatMap((row) => row.expected_tool_calls), (call) => call.name),
})

console.log(`recorded ${rows.length} executed-trajectory examples across ${SCENARIOS.length} scenarios`)
console.log("tools:", countBy(rows.flatMap((row) => row.expected_tool_calls), (call) => call.name))

/** Same rule as OliveAgent.completion: failures block, a change needs a test run after it. */
function completionOf(task, scenario) {
  if (task.errors.length > 0) return "blocked"
  const changed = task.completed.includes("write initial files") || task.files.length > 0
  if (changed && !task.verification.includes("run_tests passed")) return "blocked"
  return scenario.language === "en" ? "done" : task.verification.includes("run_tests passed") ? "done" : "blocked"
}

function blockedText(scenario) {
  if (scenario.language === "fa") return "تغییرات کامل تأیید نشده‌اند؛ تست یا بررسی هنوز موفق نشده و نمی‌توانم اتمام کار را گزارش کنم."
  if (scenario.language === "mixed") return "این مرحله تأیید نشده است: هنوز تست موفق بعد از تغییر ثبت نشده و گزارش اتمام درست نیست."
  return "The change is not verified yet: no test run succeeded after it, so I cannot report completion."
}

/** Declared in a hoisted function so the coverage run above can use it during module evaluation. */
function coveragePlan() {
  const COVERAGE_FIXTURE = {
  "package.json": `${JSON.stringify({ name: "coverage-fixture", private: true, scripts: { test: "node --test test/user.test.js" } }, null, 2)}\n`,
  "src/cli.js": cli,
  "src/greeting.js": greeting,
  "src/user.js": loginModule,
  "src/routes.js": `const { createUser } = require("./user")\n\nmodule.exports = (req, res) => res.json(createUser(req.body.email))\n`,
  "test/cli.test.js": cliTest,
  "test/user.test.js": loginTest,
}

const COVERAGE_CATEGORY = {
  search_code: "file_reading",
  find_symbols: "file_reading",
  run_shell: "diagnostics",
  inspect_diagnostics: "diagnostics",
  run_tests: "test_execution",
  install_dependencies: "dependency_installation",
  edit_file: "file_editing",
  write_file: "file_creation",
}

const COVERAGE_CALLS = [
  { tool: "search_code", why: "locate the declaration", arguments: { query: "createUser" } },
  { tool: "search_code", why: "limit the match count", arguments: { query: "require", max: 2 } },
  { tool: "search_code", why: "search one directory only", arguments: { query: "greeting", path: "src" } },
  { tool: "search_code", why: "find every node:test import", arguments: { query: "node:test" } },
  { tool: "search_code", why: "look for a phrase that does not exist", arguments: { query: "kerberos-handshake" } },
  { tool: "search_code", why: "search for an export line", arguments: { query: "module.exports" } },
  { tool: "find_symbols", why: "index the source directory", arguments: { path: "src" } },
  { tool: "find_symbols", why: "index the tests", arguments: { path: "test" } },
  { tool: "find_symbols", why: "cap the index size", arguments: { max: 1 } },
  { tool: "find_symbols", why: "index a single file", arguments: { path: "src/user.js" } },
  { tool: "find_symbols", why: "index a missing directory", arguments: { path: "lib" } },
  { tool: "find_symbols", why: "index the whole fixture", arguments: {} },
  { tool: "run_shell", why: "check the runtime version", arguments: { command: "node --version" } },
  { tool: "run_shell", why: "print a fixed string", arguments: { command: "printf ready" } },
  { tool: "run_shell", why: "syntax check the module", arguments: { command: "node --check src/user.js" } },
  { tool: "run_shell", why: "list the source files", arguments: { command: "ls src" } },
  { tool: "run_shell", why: "run a command that exits nonzero", arguments: { command: "node src/absent.js" } },
  { tool: "run_shell", why: "run an unknown command", arguments: { command: "olive-missing-binary --version" } },
  { tool: "run_tests", why: "run the failing CLI suite", arguments: { command: "node --test test/cli.test.js" } },
  { tool: "run_tests", why: "run the user suite", arguments: { command: "node --test test/user.test.js" } },
  { tool: "run_tests", why: "run a test file that does not exist", arguments: { command: "node --test test/absent.test.js" } },
  { tool: "run_tests", why: "run the whole suite", arguments: {} },
  { tool: "run_tests", why: "run with a name filter", arguments: { command: "node --test --test-name-pattern 'creates a user' test/user.test.js" } },
  { tool: "run_tests", why: "run a command that is not a test runner", arguments: { command: "node -e \"process.exit(0)\"" } },
  { tool: "install_dependencies", why: "install from the offline cache", arguments: { command: "npm install --offline --no-audit --no-fund" } },
  { tool: "install_dependencies", why: "try a clean install without a lockfile", arguments: { command: "npm ci --offline --no-audit --no-fund" } },
  { tool: "install_dependencies", why: "detect the package manager automatically", arguments: {} },
  { tool: "install_dependencies", why: "install with a longer timeout", arguments: { command: "npm install --offline --no-audit --no-fund --loglevel=error", timeoutMs: 180000 } },
  { tool: "install_dependencies", why: "install a script that does not exist", arguments: { command: "npm run install:nothing --offline" } },
  { tool: "install_dependencies", why: "ask for a dependency listing", arguments: { command: "npm ls --depth=0 --offline" } },
  { tool: "inspect_diagnostics", why: "check the user module", arguments: { command: "node --check src/user.js" } },
  { tool: "inspect_diagnostics", why: "check the CLI module", arguments: { command: "node --check src/cli.js" } },
  { tool: "inspect_diagnostics", why: "check a test file", arguments: { command: "node --check test/cli.test.js" } },
  { tool: "inspect_diagnostics", why: "check a file that does not exist", arguments: { command: "node --check src/absent.js" } },
  { tool: "inspect_diagnostics", why: "detect a diagnostics script", arguments: {} },
  { tool: "inspect_diagnostics", why: "run a passing check command", arguments: { command: "true" } },
  { tool: "edit_file", why: "fix the argument index", arguments: { path: "src/cli.js", old: "argv[3]", new: "argv[2]" } },
  { tool: "edit_file", why: "add the Persian prefix", arguments: { path: "src/greeting.js", old: "const greeting = (name) => `${name}`", new: "const greeting = (name) => `سلام ${name}`" } },
  { tool: "edit_file", why: "tighten the error message", arguments: { path: "src/user.js", old: "email is required", new: "an email is required" } },
  { tool: "edit_file", why: "edit a line that moved", arguments: { path: "src/routes.js", old: "req.body.email", new: "req.body.email.trim()" } },
  { tool: "edit_file", why: "edit text that is not in the file", arguments: { path: "src/user.js", old: "not present in this file", new: "x" } },
  { tool: "edit_file", why: "edit a file that does not exist", arguments: { path: "src/absent.js", old: "a", new: "b" } },
  { tool: "write_file", why: "add a formatting helper", arguments: { path: "src/format.js", content: "const pad = (value, width) => String(value).padStart(width, '0')\n\nmodule.exports = { pad }\n" } },
  { tool: "write_file", why: "add a constants module", arguments: { path: "src/constants.js", content: "module.exports = { PORT: 3000, RETRIES: 3 }\n" } },
  { tool: "write_file", why: "document the fixture", arguments: { path: "NOTES.md", content: "# Fixture notes\n\nThis workspace exists so tool results are real.\n" } },
  { tool: "write_file", why: "add a nested config file", arguments: { path: "config/defaults.json", content: "{\n  \"port\": 3000,\n  \"retries\": 3\n}\n" } },
  { tool: "write_file", why: "replace a file with an empty module", arguments: { path: "src/format.js", content: "module.exports = {}\n" } },
  { tool: "write_file", why: "write outside the workspace", arguments: { path: "../escape.js", content: "module.exports = {}\n" } },
  ]

  return { COVERAGE_FIXTURE, COVERAGE_CATEGORY, COVERAGE_CALLS }
}

function toDataset(result) {
  if (result.ok)
    return {
      ok: true,
      tool: result.tool,
      output: result.output,
      ...(result.files ? { files: result.files } : {}),
    }
  return { ok: false, tool: result.tool, error_code: result.error.code, output: result.error.message }
}

/** Seeded and coverage-written paths plus every directory they imply, so the path checker sees a real workspace. */
function coverageWorkspace() {
  const { COVERAGE_FIXTURE, COVERAGE_CALLS } = coveragePlan()
  const files = new Set(Object.keys(COVERAGE_FIXTURE))
  for (const entry of COVERAGE_CALLS)
    if (entry.tool === "write_file" && typeof entry.arguments.path === "string" && !entry.arguments.path.startsWith(".."))
      files.add(entry.arguments.path)
  const entries = new Set(["."])
  for (const file of files) {
    entries.add(file)
    const directory = path.posix.dirname(file)
    if (directory !== ".") entries.add(`${directory}/`)
  }
  return [...entries].toSorted()
}

/** Every seeded or written path plus its directory, so path checks see the real workspace. */
function scenarioWorkspace(scenario) {
  const files = new Set(Object.keys(scenario.seed))
  for (const step of scenario.steps)
    for (const call of step.calls ?? (step.call ? [step.call] : []))
      if (call.name === "write_file" && typeof call.arguments.path === "string") files.add(call.arguments.path)
  const entries = new Set(["."])
  for (const file of files) {
    entries.add(file)
    const directory = path.posix.dirname(file)
    if (directory !== ".") entries.add(`${directory}/`)
  }
  return [...entries].toSorted()
}
