/**
 * The projects the dataset talks about. Each archetype has a real file tree with short, syntactically valid files, the
 * commands its package manager would use, and goals in English and Persian. Generators combine these instead of
 * inventing a new project per example, which keeps every path and every import resolvable.
 */

const packageJson = (value) => `${JSON.stringify(value, null, 2)}\n`

export const PROJECTS = [
  {
    id: "node_api",
    name: "task-api",
    stack: "node",
    summary: "Express REST API with SQLite persistence",
    dirs: ["src/", "src/routes/", "test/"],
    files: {
      "package.json": packageJson({
        name: "task-api",
        version: "0.1.0",
        type: "commonjs",
        scripts: { start: "node src/server.js", test: "node --test test/", typecheck: "node --check src/server.js" },
        dependencies: { express: "^4.19.2", "better-sqlite3": "^11.0.0" },
      }),
      "src/server.js": `const express = require("express")
const tasks = require("./routes/tasks")

const app = express()
app.use(express.json())
app.use("/tasks", tasks)

app.listen(3000, () => console.log("listening on 3000"))
module.exports = app
`,
      "src/db.js": `const Database = require("better-sqlite3")
const db = new Database("tasks.db")

module.exports = db
`,
      "src/routes/tasks.js": `const express = require("express")
const db = require("../db")

const router = express.Router()

router.get("/", (req, res) => {
  res.json(db.prepare("SELECT * FROM tasks").all())
})

router.post("/", (req, res) => {
  const result = db.prepare("INSERT INTO tasks (title) VALUES (?)").run(req.body.title)
  res.status(201).json({ id: result.lastInsertRowid })
})

module.exports = router
`,
      "test/tasks.test.js": `const test = require("node:test")
const assert = require("node:assert")
const app = require("../src/server")

test("lists tasks", async () => {
  assert.ok(app)
})
`,
      "README.md": `# task-api

Small Express API for tasks. Start with \`npm start\`, test with \`npm test\`.
`,
    },
    goals: {
      en: [
        "build a task API with Express and SQLite",
        "add input validation to the task creation route",
        "create the tasks table before the server starts",
        "make the API persist tasks between restarts",
        "add a test that creates a task and reads it back",
      ],
      fa: ["یک API برای تسک‌ها با Express و SQLite بساز", "برای مسیر ساخت تسک اعتبارسنجی ورودی اضافه کن"],
    },
  },
  {
    id: "react_login",
    name: "login-app",
    stack: "react",
    summary: "React and Vite login screen whose submit button does nothing",
    dirs: ["src/", "src/components/", "src/hooks/"],
    files: {
      "package.json": packageJson({
        name: "login-app",
        private: true,
        scripts: { dev: "vite", build: "vite build", test: "vitest run", typecheck: "tsc --noEmit" },
        dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
        devDependencies: { vite: "^5.4.0", typescript: "^5.5.0", vitest: "^2.0.0" },
      }),
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Login</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      "src/main.tsx": `import { createRoot } from "react-dom/client"
import App from "./App"

createRoot(document.getElementById("root")!).render(<App />)
`,
      "src/App.tsx": `import LoginForm from "./components/LoginForm"

export default function App() {
  return (
    <main className="page">
      <h1>Sign in</h1>
      <LoginForm />
    </main>
  )
}
`,
      "src/components/LoginForm.tsx": `import { useState } from "react"
import { useAuth } from "../hooks/useAuth"

export default function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const { user } = useAuth()

  return (
    <form>
      <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
      <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Password" />
      <button type="button">Sign in</button>
      {user ? <p>Signed in as {user.email}</p> : null}
    </form>
  )
}
`,
      "src/hooks/useAuth.ts": `import { useState } from "react"

export interface User {
  email: string
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  return { user, setUser }
}
`,
      "src/styles.css": `:root {
  font-family: system-ui, sans-serif;
}

.page {
  max-width: 28rem;
  margin: 4rem auto;
}

form {
  display: grid;
  gap: 0.75rem;
}
`,
    },
    goals: {
      en: [
        "make the login button submit the form",
        "wire the login form to the useAuth hook",
        "show an error when the email is empty",
        "add a loading state to the login button",
        "connect the login form to the auth API",
      ],
      fa: ["دکمه ورود در فرم لاگین کار نمی‌کند، درستش کن", "برای فرم ورود اعتبارسنجی ایمیل اضافه کن"],
    },
  },
  {
    id: "react_dashboard",
    name: "dashboard",
    stack: "react",
    summary: "React dashboard with routes, charts and Tailwind",
    dirs: ["src/", "src/components/", "src/pages/", "src/data/"],
    files: {
      "package.json": packageJson({
        name: "dashboard",
        private: true,
        scripts: { dev: "vite", build: "vite build", typecheck: "tsc --noEmit", test: "vitest run" },
        dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.26.0" },
        devDependencies: { vite: "^5.4.0", tailwindcss: "^3.4.0", typescript: "^5.5.0" },
      }),
      "src/App.tsx": `import { BrowserRouter, Route, Routes } from "react-router-dom"
import Overview from "./pages/Overview"
import Settings from "./pages/Settings"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  )
}
`,
      "src/pages/Overview.tsx": `import StatCard from "../components/StatCard"
import { stats } from "../data/stats"

export default function Overview() {
  return (
    <section className="grid gap-4 p-6 md:grid-cols-3">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </section>
  )
}
`,
      "src/pages/Settings.tsx": `export default function Settings() {
  return <h1 className="p-6 text-xl font-semibold">Settings</h1>
}
`,
      "src/components/StatCard.tsx": `interface Props {
  label: string
  value: number
}

export default function StatCard({ label, value }: Props) {
  return (
    <article className="rounded-lg border p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold">{value}</p>
    </article>
  )
}
`,
      "src/data/stats.ts": `export const stats = [
  { label: "Users", value: 128 },
  { label: "Orders", value: 64 },
  { label: "Revenue", value: 5120 },
]
`,
      "tailwind.config.js": `module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
}
`,
      "src/index.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
    },
    goals: {
      en: [
        "add a route for a reports page",
        "make the dashboard layout responsive with Tailwind",
        "load the stats from an API instead of a constant",
        "add a loading skeleton to the stat cards",
      ],
      fa: ["یک صفحه گزارش به داشبورد اضافه کن", "کارت‌های آمار را با Tailwind واکنش‌گرا کن"],
    },
  },
  {
    id: "react_native",
    name: "mobile-notes",
    stack: "react-native",
    summary: "Expo React Native app with a stack navigator and an inactive button",
    dirs: ["src/", "src/screens/", "src/components/"],
    files: {
      "package.json": packageJson({
        name: "mobile-notes",
        main: "expo-router/entry",
        scripts: { start: "expo start", android: "expo run:android", test: "jest" },
        dependencies: { expo: "^51.0.0", react: "^18.3.1", "react-native": "^0.75.0", "@react-navigation/native": "^6.1.0" },
      }),
      "App.tsx": `import { NavigationContainer } from "@react-navigation/native"
import { createNativeStackNavigator } from "@react-navigation/native-stack"
import HomeScreen from "./src/screens/HomeScreen"

const Stack = createNativeStackNavigator()

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: "Notes" }} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
`,
      "src/screens/HomeScreen.tsx": `import { useState } from "react"
import { FlatList, Text, TouchableOpacity, View } from "react-native"
import NoteRow from "../components/NoteRow"

export default function HomeScreen() {
  const [notes, setNotes] = useState<string[]>([])

  return (
    <View>
      <TouchableOpacity>
        <Text>Add note</Text>
      </TouchableOpacity>
      <FlatList data={notes} renderItem={({ item }) => <NoteRow text={item} />} keyExtractor={(item) => item} />
    </View>
  )
}
`,
      "src/components/NoteRow.tsx": `import { Text, View } from "react-native"

export default function NoteRow({ text }: { text: string }) {
  return (
    <View>
      <Text>{text}</Text>
    </View>
  )
}
`,
      "app.json": `${JSON.stringify({ expo: { name: "mobile-notes", slug: "mobile-notes", version: "1.0.0" } }, null, 2)}\n`,
    },
    goals: {
      en: [
        "make the Add note button add a note",
        "add a second screen for editing a note",
        "persist notes with AsyncStorage",
      ],
      fa: ["دکمه افزودن یادداشت باید یک یادداشت جدید اضافه کند"],
    },
  },
  {
    id: "capacitor_android",
    name: "field-app",
    stack: "capacitor",
    summary: "Vite web app packaged as an Android APK with Capacitor",
    dirs: ["src/", "android/app/"],
    files: {
      "package.json": packageJson({
        name: "field-app",
        scripts: { dev: "vite", build: "vite build", sync: "cap sync android", apk: "cd android && ./gradlew assembleDebug" },
        dependencies: { "@capacitor/core": "^6.0.0", "@capacitor/android": "^6.0.0" },
        devDependencies: { vite: "^5.4.0" },
      }),
      "capacitor.config.ts": `import type { CapacitorConfig } from "@capacitor/cli"

const config: CapacitorConfig = {
  appId: "dev.olive.field",
  appName: "Field",
  webDir: "dist",
}

export default config
`,
      "android/app/build.gradle": `android {
    namespace "dev.olive.field"
    defaultConfig {
        applicationId "dev.olive.field"
        versionCode 1
        versionName "1.0"
    }
}
`,
      "src/main.ts": `const button = document.querySelector("button")
button?.addEventListener("click", () => {
  document.body.dataset.clicked = "true"
})
`,
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Field</title>
  </head>
  <body>
    <button>Sync</button>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`,
    },
    goals: {
      en: [
        "build a debug APK with Gradle",
        "raise the Android versionCode before the next build",
        "fix the Capacitor sync failure",
      ],
      fa: ["یک APK دیباگ با Gradle بساز"],
    },
  },
  {
    id: "python_cli",
    name: "csvtool",
    stack: "python",
    summary: "Python CLI that summarises a CSV file",
    dirs: ["tests/"],
    files: {
      "app.py": `import argparse
import csv


def summarise(path):
    with open(path, newline="") as handle:
        rows = list(csv.DictReader(handle))
    return {"rows": len(rows), "columns": list(rows[0].keys()) if rows else []}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    args = parser.parse_args()
    print(summarise(args.path))


if __name__ == "__main__":
    main()
`,
      "requirements.txt": `# no third-party dependencies
`,
      "tests/test_app.py": `from app import summarise


def test_summarise(tmp_path):
    path = tmp_path / "data.csv"
    path.write_text("name,age\\nana,30\\n")
    assert summarise(path)["rows"] == 1
`,
    },
    goals: {
      en: [
        "add a --json flag to the Python CLI",
        "make summarise raise a clear error for a missing file",
        "add a test for an empty CSV",
      ],
      fa: ["برای CLI پایتون یک فلگ json اضافه کن"],
    },
  },
  {
    id: "html_rtl",
    name: "shop-rtl",
    stack: "html",
    summary: "Persian right-to-left shop landing page",
    dirs: [],
    files: {
      "index.html": `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>فروشگاه</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <header>
      <h1>فروشگاه نمونه</h1>
    </header>
    <main>
      <section class="products">
        <article class="card">
          <h2>محصول یک</h2>
          <p>توضیح کوتاه محصول.</p>
          <button>افزودن به سبد</button>
        </article>
      </section>
    </main>
  </body>
</html>
`,
      "styles.css": `body {
  margin: 0;
  font-family: Vazirmatn, Tahoma, sans-serif;
  direction: rtl;
}

.products {
  display: grid;
  gap: 1rem;
  padding: 1.5rem;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
}

.card {
  border: 1px solid #ddd;
  border-radius: 0.5rem;
  padding: 1rem;
}
`,
      "about.html": `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <title>درباره ما</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <h1>درباره فروشگاه</h1>
  </body>
</html>
`,
    },
    goals: {
      en: ["add a right-to-left product card layout", "fix the spacing of the RTL navigation"],
      fa: ["چیدمان کارت محصول را راست‌به‌چپ درست کن", "یک نوار ناوبری راست‌به‌چپ به صفحه اضافه کن", "فاصله‌های صفحه در حالت RTL خراب است"],
    },
  },
  {
    id: "tailwind_landing",
    name: "launch-site",
    stack: "html",
    summary: "Static landing page built with Tailwind utility classes",
    dirs: ["src/"],
    files: {
      "package.json": packageJson({
        name: "launch-site",
        scripts: { build: "tailwindcss -i ./src/input.css -o ./dist/output.css --minify" },
        devDependencies: { tailwindcss: "^3.4.0" },
      }),
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Launch</title>
    <link rel="stylesheet" href="dist/output.css" />
  </head>
  <body class="bg-slate-950 text-slate-100">
    <main class="mx-auto max-w-3xl px-6 py-24">
      <h1 class="text-4xl font-bold">Ship faster</h1>
      <p class="mt-4 text-slate-400">One command to deploy.</p>
      <a class="mt-8 inline-block rounded bg-emerald-500 px-5 py-3 font-semibold" href="#start">Start</a>
    </main>
  </body>
</html>
`,
      "src/input.css": `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      "tailwind.config.js": `module.exports = {
  content: ["./index.html"],
  theme: { extend: {} },
  plugins: [],
}
`,
    },
    goals: {
      en: ["build a Tailwind hero section", "make the landing page responsive on mobile", "add a pricing section with Tailwind"],
      fa: ["یک بخش هیرو با Tailwind بساز"],
    },
  },
  {
    id: "express_auth",
    name: "auth-api",
    stack: "node",
    summary: "Express API with bearer-token middleware and a login route",
    dirs: ["src/", "src/routes/", "src/middleware/"],
    files: {
      "package.json": packageJson({
        name: "auth-api",
        type: "commonjs",
        scripts: { start: "node src/server.js", test: "node --test", typecheck: "node --check src/server.js" },
        dependencies: { express: "^4.19.2", bcrypt: "^5.1.1", jsonwebtoken: "^9.0.2" },
      }),
      "src/server.js": `const express = require("express")
const auth = require("./routes/auth")
const { requireToken } = require("./middleware/auth")

const app = express()
app.use(express.json())
app.use("/auth", auth)
app.get("/me", requireToken, (req, res) => res.json({ user: req.user }))

app.listen(4000)
`,
      "src/routes/auth.js": `const express = require("express")
const bcrypt = require("bcrypt")
const jwt = require("jsonwebtoken")

const router = express.Router()
const users = []

router.post("/register", async (req, res) => {
  const password = await bcrypt.hash(req.body.password, 10)
  users.push({ email: req.body.email, password })
  res.status(201).json({ email: req.body.email })
})

router.post("/login", async (req, res) => {
  const user = users.find((item) => item.email === req.body.email)
  if (!user) return res.status(401).json({ error: "invalid credentials" })
  const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET)
  res.json({ token })
})

module.exports = router
`,
      "src/middleware/auth.js": `function requireToken(req, res, next) {
  const header = req.headers.authorization ?? ""
  if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "missing token" })
  req.user = { email: "unknown" }
  next()
}

module.exports = { requireToken }
`,
    },
    goals: {
      en: [
        "validate the registration body before hashing the password",
        "compare the password with bcrypt before issuing a token",
        "verify the JWT in the auth middleware",
        "reject duplicate email registrations",
      ],
      fa: ["در مسیر ثبت‌نام ایمیل تکراری را رد کن"],
    },
  },
  {
    id: "crud_api",
    name: "notes-api",
    stack: "node",
    summary: "Express CRUD API backed by SQLite statements without schema setup",
    dirs: ["src/", "src/models/"],
    files: {
      "package.json": packageJson({
        name: "notes-api",
        type: "module",
        scripts: { start: "node src/app.js", test: "node --test" },
        dependencies: { express: "^4.19.2", "better-sqlite3": "^11.0.0" },
      }),
      "src/app.js": `import express from "express"
import { createNote, listNotes } from "./models/note.js"

const app = express()
app.use(express.json())

app.get("/notes", (req, res) => res.json(listNotes()))
app.post("/notes", (req, res) => res.status(201).json(createNote(req.body)))

app.listen(5000)
`,
      "src/models/note.js": `import Database from "better-sqlite3"

const db = new Database("notes.db")

export function listNotes() {
  return db.prepare("SELECT id, title FROM notes").all()
}

export function createNote({ title }) {
  const info = db.prepare("INSERT INTO notes (title) VALUES (?)").run(title)
  return { id: info.lastInsertRowid, title }
}
`,
    },
    goals: {
      en: [
        "create the notes table on startup",
        "add a delete route for notes",
        "reject notes with an empty title",
      ],
      fa: ["مسیر حذف یادداشت را اضافه کن"],
    },
  },
  {
    id: "static_site",
    name: "portfolio",
    stack: "html",
    summary: "Static portfolio with two HTML pages and shared CSS",
    dirs: [],
    files: {
      "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Portfolio</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <nav><a href="index.html">Home</a><a href="about.html">About</a></nav>
    <main>
      <h1>Ada Lovelace</h1>
      <p>Computing pioneer.</p>
    </main>
  </body>
</html>
`,
      "about.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>About</title>
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <nav><a href="index.html">Home</a><a href="about.html">About</a></nav>
    <main>
      <h1>About</h1>
      <p>Selected work from 1843.</p>
    </main>
  </body>
</html>
`,
      "styles.css": `body {
  margin: 0 auto;
  max-width: 40rem;
  font-family: Georgia, serif;
  line-height: 1.6;
  padding: 2rem;
}

nav {
  display: flex;
  gap: 1rem;
}
`,
    },
    goals: {
      en: ["add a projects section to the portfolio", "share one navigation markup across both pages"],
      fa: ["به نمونه‌کار یک بخش پروژه‌ها اضافه کن"],
    },
  },
]

export const byId = Object.fromEntries(PROJECTS.map((project) => [project.id, project]))

/** Every file path a project contains, directories included, sorted for stable prompts. */
export function workspaceOf(project) {
  return [...new Set([...project.dirs, ...Object.keys(project.files)])].toSorted()
}

export const GOALS = PROJECTS.flatMap((project) =>
  Object.entries(project.goals).flatMap(([language, goals]) => goals.map((goal) => ({ project, goal, language }))),
)
