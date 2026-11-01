import path from "node:path"
import { OLIVE_CHANNEL } from "./version"

export function databasePath(data: string) {
  const filename =
    process.env.OLIVE_DB ??
    (["latest", "dev", "beta", "next", "prod"].includes(OLIVE_CHANNEL) ||
    process.env.OLIVE_DISABLE_CHANNEL_DB === "1" ||
    process.env.OLIVE_DISABLE_CHANNEL_DB === "true"
      ? "olive.db"
      : `olive-${OLIVE_CHANNEL.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`)
  return filename === ":memory:" ? filename : path.resolve(data, filename)
}
