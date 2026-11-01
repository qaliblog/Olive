export const available = true

export async function resolveBinary() {
  return process.env.OLIVE_PTY_BIN || "opencode-pty"
}
