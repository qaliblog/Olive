// Origins a browser context may reach the local service from. The CLI and TUI are not browsers; this only guards
// WebSocket upgrades and other requests that carry an Origin header, keeping drive-by pages off the local service.
export function isAllowedRequestOrigin(input: string | undefined, host: string | undefined) {
  if (!input) return true
  if (host && sameHost(input, host)) return true
  if (input.startsWith("http://localhost:")) return true
  if (input.startsWith("http://127.0.0.1:")) return true
  return false
}

function sameHost(origin: string, host: string) {
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
