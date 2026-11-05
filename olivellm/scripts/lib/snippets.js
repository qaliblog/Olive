/**
 * Code the dataset teaches. Every snippet is short on purpose: one file, complete enough to run, no placeholder
 * comments. `check` names the parser the validator must use: "bun" for js/ts/tsx, "python" for python, "markup" for
 * html (tag balance, no parser available), "css" for css (brace and declaration shape), "none" when no checker is
 * installed. `none` is reported as a limitation, never as a pass.
 */
export const SNIPPETS = [
  {
    id: "express_validation",
    projectId: "node_api",
    file: "src/routes/tasks.js",
    fence: "js",
    check: "bun",
    goal: { en: "validate the task creation body before inserting", fa: "بدنه‌ی ساخت تسک را قبل از درج اعتبارسنجی کن" },
    intro: "Validate the title in the route itself and return 400 before touching SQLite.",
    code: `router.post("/", (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : ""
  if (title.length === 0) return res.status(400).json({ error: "title is required" })
  const result = db.prepare("INSERT INTO tasks (title) VALUES (?)").run(title)
  res.status(201).json({ id: result.lastInsertRowid, title })
})`,
  },
  {
    id: "sqlite_init",
    projectId: "node_api",
    file: "src/db.js",
    fence: "js",
    check: "bun",
    goal: { en: "create the tasks table before the server starts", fa: "جدول تسک‌ها را قبل از بالا آمدن سرور بساز" },
    intro: "Create the table where the connection is opened, so every route sees it.",
    code: `const Database = require("better-sqlite3")
const db = new Database("tasks.db")

db.exec("CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)")

module.exports = db`,
  },
  {
    id: "express_error_handler",
    projectId: "node_api",
    file: "src/server.js",
    fence: "js",
    check: "bun",
    goal: { en: "add a JSON error handler", fa: "یک هندلر خطای JSON اضافه کن" },
    intro: "Register one terminal error handler after the routes so thrown errors become JSON, not HTML.",
    code: `app.use((error, req, res, next) => {
  console.error(error)
  res.status(500).json({ error: "internal error" })
})`,
  },
  {
    id: "jwt_middleware",
    projectId: "express_auth",
    file: "src/middleware/auth.js",
    fence: "js",
    check: "bun",
    goal: { en: "verify the bearer token instead of trusting it", fa: "توکن bearer را بررسی کن، نه اینکه به آن اعتماد کنی" },
    intro: "jwt.verify throws on a bad token, so catch it and return 401.",
    code: `const jwt = require("jsonwebtoken")

function requireToken(req, res, next) {
  const header = req.headers.authorization ?? ""
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "missing token" })
  let decoded
  try {
    decoded = jwt.verify(header.slice(7), process.env.JWT_SECRET)
  } catch {
    return res.status(401).json({ error: "invalid token" })
  }
  req.user = { email: decoded.email }
  next()
}

module.exports = { requireToken }`,
  },
  {
    id: "bcrypt_login",
    projectId: "express_auth",
    file: "src/routes/auth.js",
    fence: "js",
    check: "bun",
    goal: { en: "compare the password before issuing a token", fa: "قبل از صدور توکن رمز عبور را مقایسه کن" },
    intro: "A login must compare the hash; signing a token for any known email is not authentication.",
    code: `router.post("/login", async (req, res) => {
  const user = users.find((item) => item.email === req.body.email)
  if (!user) return res.status(401).json({ error: "invalid credentials" })
  const matches = await bcrypt.compare(req.body.password, user.password)
  if (!matches) return res.status(401).json({ error: "invalid credentials" })
  const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: "1h" })
  res.json({ token })
})`,
  },
  {
    id: "sqlite_delete",
    projectId: "crud_api",
    file: "src/routes/tasks.js",
    fence: "js",
    check: "bun",
    goal: { en: "add a delete route for tasks", fa: "مسیر حذف تسک را اضافه کن" },
    intro: "Validate the id, delete once, and distinguish a missing row with 404.",
    code: `router.delete("/:id", (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: "id must be an integer" })
  const result = db.prepare("DELETE FROM tasks WHERE id = ?").run(id)
  if (result.changes === 0) return res.status(404).json({ error: "task not found" })
  res.status(204).end()
})`,
  },
  {
    id: "validate_title",
    projectId: "node_api",
    file: "src/validate.js",
    fence: "js",
    check: "bun",
    goal: { en: "extract title validation into a testable function", fa: "اعتبارسنجی عنوان را به یک تابع قابل تست منتقل کن" },
    intro: "Pure function, no framework state, so the test can call it directly.",
    code: `function validateTitle(value) {
  if (typeof value !== "string") return undefined
  const title = value.trim()
  return title.length === 0 ? undefined : title
}

module.exports = { validateTitle }`,
  },
  {
    id: "node_test_route",
    projectId: "node_api",
    file: "test/validate.test.js",
    fence: "js",
    check: "bun",
    goal: { en: "add a test for empty and trimmed titles", fa: "برای عنوان خالی و اصلاح‌شده تست بنویس" },
    intro: "Two cases: the rejection and the trim. Both call the real function.",
    code: `const test = require("node:test")
const assert = require("node:assert")
const { validateTitle } = require("../src/validate")

test("rejects an empty title", () => {
  assert.equal(validateTitle("   "), undefined)
})

test("trims a valid title", () => {
  assert.equal(validateTitle("  ship it  "), "ship it")
})`,
  },
  {
    id: "react_submit",
    projectId: "react_login",
    file: "src/components/LoginForm.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "make the login button submit the form", fa: "دکمه ورود فرم را ارسال کند" },
    intro: "The button needs type submit and the form needs onSubmit; the success path sets the user from the API.",
    code: `import { useState } from "react"
import { useAuth } from "../hooks/useAuth"

export default function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const { user, setUser } = useAuth()

  async function submit(event: { preventDefault: () => void }) {
    event.preventDefault()
    if (email.trim().length === 0) {
      setError("Email is required")
      return
    }
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) {
      setError("Invalid email or password")
      return
    }
    setError("")
    setUser(await response.json())
  }

  return (
    <form onSubmit={submit}>
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" />
      <button type="submit">Sign in</button>
      {error ? <p role="alert">{error}</p> : null}
      {user ? <p>Signed in as {user.email}</p> : null}
    </form>
  )
}`,
  },
  {
    id: "react_useauth",
    projectId: "react_login",
    file: "src/hooks/useAuth.ts",
    fence: "ts",
    check: "bun",
    goal: { en: "add a login function to useAuth", fa: "به useAuth یک تابع ورود اضافه کن" },
    intro: "Keep the hook responsible for the request and throw on failure so the form decides what to show.",
    code: `import { useState } from "react"

export interface User {
  email: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)

  async function login(email: string, password: string) {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    if (!response.ok) throw new Error("Invalid credentials")
    setUser((await response.json()) as User)
  }

  return { user, setUser, login }
}`,
  },
  {
    id: "react_statcard_loading",
    projectId: "react_dashboard",
    file: "src/components/StatCard.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "add a loading skeleton to the stat card", fa: "به کارت آمار حالت بارگذاری اضافه کن" },
    intro: "One optional prop and one placeholder; no extra library.",
    code: `interface Props {
  label: string
  value?: number
  loading?: boolean
}

export default function StatCard({ label, value, loading = false }: Props) {
  return (
    <article className="rounded-lg border p-4" aria-busy={loading}>
      <p className="text-sm text-slate-500">{label}</p>
      {loading ? <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-200" /> : <p className="text-2xl font-bold">{value ?? 0}</p>}
    </article>
  )
}`,
  },
  {
    id: "react_reports_route",
    projectId: "react_dashboard",
    file: "src/App.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "add a reports route", fa: "یک مسیر گزارش‌ها اضافه کن" },
    intro: "Add the route beside the existing ones; the page component is separate.",
    code: `import { BrowserRouter, Route, Routes } from "react-router-dom"
import Overview from "./pages/Overview"
import Reports from "./pages/Reports"
import Settings from "./pages/Settings"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  )
}`,
  },
  {
    id: "react_reports_page",
    projectId: "react_dashboard",
    file: "src/pages/Reports.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "create the reports page component", fa: "کامپوننت صفحه گزارش‌ها را بساز" },
    intro: "The page the new route points at.",
    code: `export default function Reports() {
  return (
    <section className="p-6">
      <h1 className="text-xl font-semibold">Reports</h1>
      <p className="mt-2 text-slate-500">No reports yet.</p>
    </section>
  )
}`,
  },
  {
    id: "react_labels",
    projectId: "react_login",
    file: "src/components/TextField.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "add accessible labels to the form inputs", fa: "به ورودی‌های فرم برچسب دسترس‌پذیر اضافه کن" },
    intro: "htmlFor plus a matching id is what makes the label announce for the input.",
    code: `interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

export default function TextField({ id, label, value, onChange }: Props) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  )
}`,
  },
  {
    id: "react_debounce",
    projectId: "react_dashboard",
    file: "src/hooks/useDebouncedValue.ts",
    fence: "ts",
    check: "bun",
    goal: { en: "debounce the search input", fa: "ورودی جست‌وجو را دیبانس کن" },
    intro: "A hook with one timer and a cleanup, so typing does not fire a request per key.",
    code: `import { useEffect, useState } from "react"

export function useDebouncedValue<T>(value: T, delayMs = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}`,
  },
  {
    id: "rn_add_note",
    projectId: "react_native",
    file: "src/screens/HomeScreen.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "make the Add note button add a note", fa: "دکمه افزودن یادداشت یک یادداشت اضافه کند" },
    intro: "The button needs onPress, and the draft needs its own state so the list only grows on submit.",
    code: `import { useState } from "react"
import { FlatList, Text, TextInput, TouchableOpacity, View } from "react-native"
import NoteRow from "../components/NoteRow"

export default function HomeScreen() {
  const [notes, setNotes] = useState<string[]>([])
  const [draft, setDraft] = useState("")

  function addNote() {
    const text = draft.trim()
    if (text.length === 0) return
    setNotes((current) => [...current, text])
    setDraft("")
  }

  return (
    <View>
      <TextInput value={draft} onChangeText={setDraft} placeholder="New note" />
      <TouchableOpacity onPress={addNote}>
        <Text>Add note</Text>
      </TouchableOpacity>
      <FlatList data={notes} renderItem={({ item }) => <NoteRow text={item} />} keyExtractor={(item) => item} />
    </View>
  )
}`,
  },
  {
    id: "rn_edit_screen",
    projectId: "react_native",
    file: "src/screens/EditScreen.tsx",
    fence: "tsx",
    check: "bun",
    goal: { en: "add a screen for editing a note", fa: "یک صفحه برای ویرایش یادداشت اضافه کن" },
    intro: "Typed route params keep the screen independent from the navigator's types.",
    code: `import { useState } from "react"
import { Button, Text, TextInput, View } from "react-native"

interface Props {
  route: { params: { text: string } }
  navigation: { goBack: () => void }
}

export default function EditScreen({ route, navigation }: Props) {
  const [text, setText] = useState(route.params.text)
  return (
    <View>
      <TextInput value={text} onChangeText={setText} />
      <Button title="Save" onPress={() => navigation.goBack()} />
      <Text>{text}</Text>
    </View>
  )
}`,
  },
  {
    id: "capacitor_version",
    projectId: "capacitor_android",
    file: "android/app/build.gradle",
    fence: "groovy",
    check: "none",
    goal: { en: "raise the Android versionCode before the next build", fa: "قبل از بیلد بعدی versionCode اندروید را بالا ببر" },
    intro: "Raise versionCode; versionName is the human-facing string.",
    code: `android {
    defaultConfig {
        applicationId "dev.olive.field"
        versionCode 2
        versionName "1.1"
    }
}`,
  },
  {
    id: "python_json_flag",
    projectId: "python_cli",
    file: "app.py",
    fence: "python",
    check: "python",
    goal: { en: "add a --json flag to the Python CLI", fa: "به CLI پایتون یک فلگ json اضافه کن" },
    intro: "One boolean flag, and json.dumps only on the branch that asks for it.",
    code: `import argparse
import csv
import json


def summarise(path):
    with open(path, newline="") as handle:
        rows = list(csv.DictReader(handle))
    return {"rows": len(rows), "columns": list(rows[0].keys()) if rows else []}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    summary = summarise(args.path)
    print(json.dumps(summary) if args.json else summary)


if __name__ == "__main__":
    main()`,
  },
  {
    id: "python_missing_file",
    projectId: "python_cli",
    file: "app.py",
    fence: "python",
    check: "python",
    goal: { en: "make a missing input file a clear error", fa: "نبود فایل ورودی را به خطای واضح تبدیل کن" },
    intro: "Turn FileNotFoundError into a short message the CLI user can act on.",
    code: `import csv


def summarise(path):
    try:
        with open(path, newline="") as handle:
            rows = list(csv.DictReader(handle))
    except FileNotFoundError:
        raise SystemExit(f"input file not found: {path}") from None
    return {"rows": len(rows), "columns": list(rows[0].keys()) if rows else []}`,
  },
  {
    id: "python_empty_csv_test",
    projectId: "python_cli",
    file: "tests/test_empty.py",
    fence: "python",
    check: "python",
    goal: { en: "add a test for an empty CSV", fa: "برای CSV خالی تست اضافه کن" },
    intro: "tmp_path keeps the test independent of the working directory.",
    code: `from app import summarise


def test_empty_csv(tmp_path):
    path = tmp_path / "empty.csv"
    path.write_text("name,age\\n")
    summary = summarise(path)
    assert summary["rows"] == 0
    assert summary["columns"] == ["name", "age"]`,
  },
  {
    id: "html_rtl_nav",
    projectId: "html_rtl",
    file: "index.html",
    fence: "html",
    check: "markup",
    goal: { en: "add a right-to-left navigation bar", fa: "یک نوار ناوبری راست‌به‌چپ اضافه کن" },
    intro: "A labelled nav landmark; direction comes from the document, so no per-element direction is needed.",
    code: `<nav class="nav" aria-label="ناوبری اصلی">
  <a href="index.html">خانه</a>
  <a href="products.html">محصولات</a>
  <a href="about.html">درباره ما</a>
</nav>`,
  },
  {
    id: "css_rtl_nav",
    projectId: "html_rtl",
    file: "styles.css",
    fence: "css",
    check: "css",
    goal: { en: "style the navigation for right-to-left text", fa: "ناوبری را برای متن راست‌به‌چپ استایل بده" },
    intro: "Flexbox follows the document direction; only the focus ring needs explicit work.",
    code: `.nav {
  display: flex;
  gap: 1.5rem;
  padding: 1rem 1.5rem;
  direction: rtl;
  border-bottom: 1px solid #e5e7eb;
}

.nav a {
  color: inherit;
  text-decoration: none;
}

.nav a:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}`,
  },
  {
    id: "css_logical_properties",
    projectId: "html_rtl",
    file: "styles.css",
    fence: "css",
    check: "css",
    goal: { en: "fix the spacing of the RTL product cards", fa: "فاصله‌گذاری کارت‌های محصول در حالت RTL را درست کن" },
    intro: "Logical properties mirror with the direction instead of hard-coding left and right.",
    code: `.card {
  padding-inline: 1rem;
  margin-inline-start: 0.5rem;
  text-align: start;
  border-inline-start: 3px solid #2563eb;
}`,
  },
  {
    id: "css_responsive_grid",
    projectId: "html_rtl",
    file: "styles.css",
    fence: "css",
    check: "css",
    goal: { en: "make the product grid responsive", fa: "شبکه محصولات را واکنش‌گرا کن" },
    intro: "auto-fill already adapts; the media query only fixes the padding on small screens.",
    code: `.products {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  padding: 1.5rem;
}

@media (max-width: 40rem) {
  .products {
    grid-template-columns: 1fr;
    padding: 0.75rem;
  }
}`,
  },
  {
    id: "html_form_a11y",
    projectId: "html_rtl",
    file: "index.html",
    fence: "html",
    check: "markup",
    goal: { en: "make the subscribe form accessible", fa: "فرم عضویت را دسترس‌پذیر کن" },
    intro: "Label, type and required are the three attributes that matter here.",
    code: `<form class="card" action="/subscribe" method="post">
  <label for="email">ایمیل</label>
  <input id="email" name="email" type="email" required autocomplete="email" />
  <button type="submit">عضویت</button>
</form>`,
  },
  {
    id: "tailwind_hero",
    projectId: "tailwind_landing",
    file: "index.html",
    fence: "html",
    check: "markup",
    goal: { en: "build the landing hero with Tailwind", fa: "بخش هیرو را با Tailwind بساز" },
    intro: "Centred copy, one call to action, responsive type.",
    code: `<section class="bg-slate-950 text-slate-100">
  <div class="mx-auto max-w-3xl px-6 py-24 text-center">
    <h1 class="text-4xl font-bold sm:text-5xl">Ship faster</h1>
    <p class="mt-4 text-slate-400">One command to deploy.</p>
    <a class="mt-8 inline-block rounded bg-emerald-500 px-5 py-3 font-semibold text-slate-950" href="#start">Start</a>
  </div>
</section>`,
  },
  {
    id: "tailwind_pricing",
    projectId: "tailwind_landing",
    file: "index.html",
    fence: "html",
    check: "markup",
    goal: { en: "add a pricing section with Tailwind", fa: "یک بخش قیمت‌گذاری با Tailwind اضافه کن" },
    intro: "Three columns on desktop, one on mobile.",
    code: `<section class="mx-auto grid max-w-4xl gap-6 px-6 py-16 md:grid-cols-3">
  <article class="rounded-lg border border-slate-800 p-6">
    <h2 class="text-lg font-semibold">Free</h2>
    <p class="mt-2 text-3xl font-bold">$0</p>
    <p class="mt-4 text-sm text-slate-400">One project, community support.</p>
  </article>
</section>`,
  },
  {
    id: "ts_validate_email",
    projectId: "react_login",
    file: "src/validate.ts",
    fence: "ts",
    check: "bun",
    goal: { en: "add email validation before submitting", fa: "قبل از ارسال، ایمیل را اعتبارسنجی کن" },
    intro: "A single predicate the form and the hook can share.",
    code: `export function isEmail(value: string) {
  return /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(value)
}`,
  },
]

export const byId = Object.fromEntries(SNIPPETS.map((snippet) => [snippet.id, snippet]))
