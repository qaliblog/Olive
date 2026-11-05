/**
 * Syntax gate for JavaScript, TypeScript, JSX and TSX snippets, run with Bun.
 * Usage: bun check-syntax.js <file> <loader>
 * Exits non-zero and prints the parser error when the snippet does not parse.
 */
const [file, loader = "js"] = process.argv.slice(2)
if (!file) {
  console.error("usage: bun check-syntax.js <file> <loader>")
  process.exit(2)
}
const code = await Bun.file(file).text()
try {
  new Bun.Transpiler({ loader }).transformSync(code)
  console.log("ok")
} catch (cause) {
  console.error(cause.message)
  process.exit(1)
}
